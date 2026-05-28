import { EventEmitter } from "node:events";
import type { TradeOrder, PaperPosition, TradeResponse, OrderSide, OrderType } from "./types.js";
import { tradeRepo } from "../db/repositories/trade-repo.js";
import { evaluatePosition } from "../analysis/trade.js";

export interface TradeContext {
  aiReasoning?: string;
  aiConfidence?: number;
  vixLevel?: number;
  rsiLevel?: number;
  trend15m?: string;
  aiStopLoss?: number;
  aiTarget?: number;
  aiStrike?: number;
  aiSetup?: string;
  strategyContext?: any;
}

export class PaperTrader extends EventEmitter {
  private positions: Map<string, PaperPosition> = new Map();
  private orders: TradeOrder[] = [];
  private initialized = false;
  private initializationPromise: Promise<void> | null = null;
  private exitingPositions: Set<string> = new Set();
  public maxConcurrentPositions = Number(process.env.MAX_PAPER_POSITIONS || 2);

  constructor() {
    super();
  }

  async initialize() {
    if (this.initialized) return;
    if (this.initializationPromise) return this.initializationPromise;

    this.initializationPromise = (async () => {
      try {
        const openTrades = await tradeRepo.getOpenTrades();
        console.log(`[PaperTrader] Restoring ${openTrades.length} open trades from DB...`);
        
        for (const trade of openTrades) {
          // Group by symbol to reconstruct positions
          const existing = this.positions.get(trade.symbol);
          if (existing) {
            const totalQty = existing.quantity + trade.quantity;
            const totalCost = (existing.avgEntryPrice * existing.quantity) + (trade.entry_price * trade.quantity);
            existing.avgEntryPrice = totalCost / totalQty;
            existing.quantity = totalQty;
          } else {
            const pos: PaperPosition = {
              symbol: trade.symbol,
              token: trade.token || 0,
              side: "BUY",
              quantity: trade.quantity,
              avgEntryPrice: trade.entry_price,
              currentPrice: trade.entry_price,
              unrealizedPnL: 0,
              realizedPnL: 0,
              timestamp: new Date(trade.opened_at),
            };
            if (trade.strike_price) pos.strike = trade.strike_price;
            if (trade.ai_stop_loss) pos.aiStopLoss = trade.ai_stop_loss;
            if (trade.ai_target) pos.aiTarget = trade.ai_target;
            
            this.positions.set(trade.symbol, pos);
          }
        }
        this.initialized = true;
        console.log("[PaperTrader] Initialization complete.");
        
        // Start market status monitoring
        this.startMarketMonitor();
        // Start AI position management
        this.startPositionManager();
      } catch (err) {
        console.error("[PaperTrader] Failed to initialize:", err);
      } finally {
        this.initializationPromise = null;
      }
    })();

    return this.initializationPromise;
  }

  private startMarketMonitor() {
    setInterval(() => {
      this.checkMarketStatus();
    }, 60 * 1000); // Check every minute
  }

  private startPositionManager() {
    const intervalMins = Number(process.env.POSITION_EVAL_INTERVAL_MINS || 3);
    console.log(`[Risk Manager] Starting periodic position re-evaluation every ${intervalMins} minutes...`);
    
    setInterval(async () => {
      const positions = this.getAllPositions();
      if (positions.length === 0) return;

      console.log(`[Risk Manager] Re-evaluating ${positions.length} active positions...`);
      
      for (const pos of positions) {
        try {
          // Identify underlying symbol (e.g., from NIFTY24MAY24100CE to NIFTY)
          const symbol = pos.symbol.startsWith("NIFTY") ? "NIFTY" : pos.symbol.startsWith("BANKNIFTY") ? "BANKNIFTY" : pos.symbol;
          
          const { decision, marketData } = await evaluatePosition(symbol, pos);
          
          if (decision.decision === "EXIT") {
            console.log(`[Risk Manager] AI signaled EXIT for ${pos.symbol}. Reason: ${decision.reason}`);
            await this.placeOrder({
              symbol: pos.symbol,
              token: pos.token,
              side: "SELL",
              quantity: pos.quantity,
              price: pos.currentPrice,
              context: { aiReasoning: decision.reason }
            });
          } else if (decision.decision === "UPDATE_SL" && decision.newIndexStopLoss) {
            // TRANSLATE INDEX TRAILING STOP TO PREMIUM
            const currentIndexPrice = marketData.tf15m.price;
            
            // Logic: Calculate how many points the Index SL moved, then apply 50% of that to Option Premium
            const indexRiskPoints = Math.abs(currentIndexPrice - decision.newIndexStopLoss);
            const optionRiskPoints = indexRiskPoints * 0.5;
            
            const newPremiumSl = pos.currentPrice - optionRiskPoints;
            const newPremiumTarget = pos.currentPrice + (optionRiskPoints * (decision.riskRewardRatio || 1.5));

            console.log(`[Risk Manager] AI signaled UPDATE_SL for ${pos.symbol}. Index SL: ${decision.newIndexStopLoss} -> Premium SL: ${newPremiumSl.toFixed(2)}`);
            
            pos.aiStopLoss = newPremiumSl;
            pos.aiTarget = newPremiumTarget;
            
            this.emit("notification", {
              title: "🛡️ Trailing Stop Updated",
              message: `${pos.symbol}: SL moved to ${newPremiumSl.toFixed(2)} based on Index structure`,
              type: "info"
            });
          }
        } catch (err) {
          console.error(`[Risk Manager] Failed to re-evaluate position ${pos.symbol}:`, err);
        }
      }
    }, intervalMins * 60 * 1000);
  }

  private checkMarketStatus() {
    const now = new Date();
    // Convert to IST (UTC+5:30)
    const istTime = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
    const hours = istTime.getUTCHours();
    const minutes = istTime.getUTCMinutes();

    // 1. Square-off at 3:25 PM IST (15:25)
    if (hours === 15 && minutes === 25) {
      const positions = this.getAllPositions();
      if (positions.length > 0) {
        console.log(`[EXIT] 15:25 IST - Market Square-off triggered for ${positions.length} positions.`);
        this.squareOffAll();
      }
    }

    // 2. Market Close at 3:30 PM IST (15:30)
    if (hours === 15 && minutes === 30) {
      console.log("[EXIT] 15:30 IST - Market Closed. Emitting shutdown signal.");
      this.emit("market_close");
    }
  }

  async squareOffAll() {
    const positions = this.getAllPositions();
    for (const pos of positions) {
      if (this.exitingPositions.has(pos.symbol)) continue;
      
      await this.placeOrder({
        symbol: pos.symbol,
        token: pos.token,
        side: "SELL",
        quantity: pos.quantity,
        price: pos.currentPrice,
        context: { aiReasoning: "Market Square-off" }
      });
    }
  }

  async placeOrder(params: {
    symbol: string;
    token: number;
    strike?: number;
    side: OrderSide;
    quantity: number;
    price: number;
    context?: TradeContext;
  }): Promise<TradeResponse> {
    await this.initialize();

    if (params.side === "BUY") {
      // 1. Check Max Concurrent Positions
      if (this.positions.size >= this.maxConcurrentPositions) {
        const msg = `❌ [PAPER TRADE] Limit reached: ${this.positions.size}/${this.maxConcurrentPositions} active positions. Skipping ${params.symbol}`;
        console.log(msg);
        return { success: false, error: "Maximum concurrent positions reached" };
      }

      // 2. Check if already have a position for this symbol
      if (this.positions.has(params.symbol)) {
        const msg = `❌ [PAPER TRADE] Position already exists for ${params.symbol}. Skipping duplicate entry.`;
        console.log(msg);
        return { success: false, error: "Position already exists for this symbol" };
      }

      // 3. Check if already have a position for this strike level
      const strike = params.strike || params.context?.aiStrike;
      if (strike) {
        const existingStrike = Array.from(this.positions.values()).find(p => p.strike === strike);
        if (existingStrike) {
          const msg = `❌ [PAPER TRADE] Position already exists for strike ${strike} (${existingStrike.symbol}). Skipping duplicate level entry.`;
          console.log(msg);
          return { success: false, error: `Position already exists for strike ${strike}` };
        }
      }
    }

    if (params.side === "SELL") {
      if (this.exitingPositions.has(params.symbol)) {
        return { success: false, error: "Exit already in progress" };
      }
      this.exitingPositions.add(params.symbol);
    }

    const orderId = `paper_${Math.random().toString(36).substr(2, 9)}`;
    
    const order: TradeOrder = {
      id: orderId,
      symbol: params.symbol,
      token: params.token,
      side: params.side,
      quantity: params.quantity,
      price: params.price,
      type: "MARKET",
      status: "COMPLETE",
      timestamp: new Date(),
    };
    const strike = params.strike || params.context?.aiStrike;
    if (strike) order.strike = strike;

    this.orders.push(order);
    await this.updatePosition(order, params.context);

    // PERSIST TO DATABASE
    if (order.side === "BUY") {
      await tradeRepo.insertTrade({
        symbol: order.symbol,
        token: order.token,
        side: "BUY",
        quantity: order.quantity,
        entry_price: order.price!,
        strike_price: order.strike || null,
        ai_reasoning: params.context?.aiReasoning || null,
        ai_confidence: params.context?.aiConfidence || null,
        vix_level: params.context?.vixLevel || null,
        rsi_level: params.context?.rsiLevel || null,
        trend_15m: params.context?.trend15m || null,
        ai_stop_loss: params.context?.aiStopLoss || null,
        ai_target: params.context?.aiTarget || null,
        exit_reason: null,
        setup: params.context?.aiSetup || null,
        strategy_context: params.context?.strategyContext ? JSON.stringify(params.context.strategyContext) : null,
      }).catch(err => console.error("❌ Failed to save paper trade to DB:", err));
    }

    console.log(`📝 [PAPER TRADE] ${order.side} ${order.quantity}x ${order.symbol} @ ${order.price}`);
    
    // Safety check: If AI provides an invalid SL (higher than entry for a BUY), 
    // we should invalidate that SL to prevent an immediate exit loop.
    const pos = this.positions.get(order.symbol);
    if (pos && pos.side === "BUY") {
      if (pos.aiStopLoss !== undefined && pos.aiStopLoss >= order.price!) {
        console.warn(`⚠️ [PAPER TRADE] Invalid SL (${pos.aiStopLoss}) for BUY at ${order.price}. Disabling SL for this position to prevent immediate exit.`);
        delete pos.aiStopLoss;
      }
      if (pos.aiTarget !== undefined && pos.aiTarget <= order.price!) {
        console.warn(`⚠️ [PAPER TRADE] Invalid Target (${pos.aiTarget}) for BUY at ${order.price}. Disabling Target for this position.`);
        delete pos.aiTarget;
      }
    }

    // Determine notification details
    let title = order.side === "BUY" ? "🚀 Trade Executed" : "✅ Position Closed";
    let type = order.side === "BUY" ? "success" : "info";
    
    if (order.side === "SELL") {
      const existing = this.positions.get(order.symbol);
      if (existing) {
        if (existing.aiStopLoss && order.price! <= existing.aiStopLoss) {
          title = "🛑 Stop-Loss Hit";
          type = "error";
        } else if (existing.aiTarget && order.price! >= existing.aiTarget) {
          title = "🎯 Target Reached";
          type = "success";
        }
      }
    }

    this.emit("notification", {
      title,
      message: `${order.side} ${order.quantity}x ${order.symbol} @ ${order.price}`,
      type,
      details: {
        symbol: order.symbol,
        price: order.price,
        side: order.side,
        stopLoss: params.context?.aiStopLoss || this.positions.get(order.symbol)?.aiStopLoss,
        target: params.context?.aiTarget || this.positions.get(order.symbol)?.aiTarget
      }
    });

    this.emit("order_update", order);
    this.emit("portfolio_update", this.getAllPositions());

    if (params.side === "SELL") {
      this.exitingPositions.delete(params.symbol);
    }

    return { success: true, orderId };
  }

  private async updatePosition(order: TradeOrder, context?: TradeContext) {
    const existing = this.positions.get(order.symbol);

    if (order.side === "BUY") {
      if (existing) {
        const totalQty = existing.quantity + order.quantity;
        const totalCost = (existing.avgEntryPrice * existing.quantity) + (order.price! * order.quantity);
        existing.avgEntryPrice = totalCost / totalQty;
        existing.quantity = totalQty;
        // Update SL/Target if new context provided
        if (context?.aiStopLoss) existing.aiStopLoss = context.aiStopLoss;
        if (context?.aiTarget) existing.aiTarget = context.aiTarget;
        if (order.strike) existing.strike = order.strike;
      } else {
        const pos: PaperPosition = {
          symbol: order.symbol,
          token: order.token,
          side: "BUY",
          quantity: order.quantity,
          avgEntryPrice: order.price!,
          currentPrice: order.price!,
          unrealizedPnL: 0,
          realizedPnL: 0,
          timestamp: new Date(),
        };
        if (order.strike) pos.strike = order.strike;
        if (context?.aiStopLoss) pos.aiStopLoss = context.aiStopLoss;
        if (context?.aiTarget) pos.aiTarget = context.aiTarget;
        if (context?.aiSetup) pos.aiSetup = context.aiSetup;
        if (context?.strategyContext) pos.strategyContext = context.strategyContext;
        
        this.positions.set(order.symbol, pos);
      }
    } else {
      // Simple SELL logic: Close position
      if (existing) {
        const pnl = (order.price! - existing.avgEntryPrice) * order.quantity;
        existing.realizedPnL += pnl;
        existing.quantity -= order.quantity;

        // DB: We'll need to find the correct trade ID. 
        // For now, let's assume we find the most recent open trade for this symbol.
        const openTrades = await tradeRepo.getOpenTrades();
        const targetTrade = openTrades.find(t => t.symbol === order.symbol);
        if (targetTrade) {
          await tradeRepo.closeTrade(targetTrade.id, order.price!, context?.aiReasoning).catch(err => console.error("❌ Failed to close trade in DB:", err));
        }

        if (existing.quantity <= 0) {
          this.positions.delete(order.symbol);
        }
      }
    }
  }

  async updatePrice(token: number, price: number) {
    if (!this.initialized) await this.initialize();
    
    let changed = false;
    for (const [symbol, pos] of this.positions) {
      if (pos.token === token) {
        pos.currentPrice = price;
        pos.unrealizedPnL = (price - pos.avgEntryPrice) * pos.quantity;
        changed = true;

        // Automated Exit Monitoring
        if (pos.side === "BUY" && !this.exitingPositions.has(symbol)) {
          if (pos.aiStopLoss && price <= pos.aiStopLoss) {
            console.log(`[EXIT] Stop-Loss hit for ${symbol} @ ${price} (SL: ${pos.aiStopLoss})`);
            await this.placeOrder({
              symbol: pos.symbol,
              token: pos.token,
              side: "SELL",
              quantity: pos.quantity,
              price: price,
              context: { aiReasoning: "Stop-Loss hit" }
            });
          } else if (pos.aiTarget && price >= pos.aiTarget) {
            console.log(`[EXIT] Target reached for ${symbol} @ ${price} (Target: ${pos.aiTarget})`);
            await this.placeOrder({
              symbol: pos.symbol,
              token: pos.token,
              side: "SELL",
              quantity: pos.quantity,
              price: price,
              context: { aiReasoning: "Target reached" }
            });
          }
        }
      }
    }
    if (changed) {
      this.emit("pnl_update", this.getAllPositions());
    }
  }

  getAllPositions(): PaperPosition[] {
    return Array.from(this.positions.values());
  }

  getOrders(): TradeOrder[] {
    return this.orders;
  }
}

// Singleton for easy access across the app
export const paperTrader = new PaperTrader();
