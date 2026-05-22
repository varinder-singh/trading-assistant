import { EventEmitter } from "node:events";
import type { TradeOrder, PaperPosition, TradeResponse, OrderSide, OrderType } from "./types.js";
import { tradeRepo } from "../db/repositories/trade-repo.js";

export interface TradeContext {
  aiReasoning?: string;
  aiConfidence?: number;
  vixLevel?: number;
  rsiLevel?: number;
  trend15m?: string;
  aiStopLoss?: number;
  aiTarget?: number;
}

export class PaperTrader extends EventEmitter {
  private positions: Map<string, PaperPosition> = new Map();
  private orders: TradeOrder[] = [];
  private initialized = false;
  private initializationPromise: Promise<void> | null = null;
  private exitingPositions: Set<string> = new Set();

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
            this.positions.set(trade.symbol, {
              symbol: trade.symbol,
              token: trade.token || 0,
              side: "BUY",
              quantity: trade.quantity,
              avgEntryPrice: trade.entry_price,
              currentPrice: trade.entry_price,
              unrealizedPnL: 0,
              realizedPnL: 0,
              aiStopLoss: trade.ai_stop_loss || undefined,
              aiTarget: trade.ai_target || undefined,
              timestamp: new Date(trade.opened_at),
            });
          }
        }
        this.initialized = true;
        console.log("[PaperTrader] Initialization complete.");
        
        // Start market status monitoring
        this.startMarketMonitor();
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
      });
    }
  }

  async placeOrder(params: {
    symbol: string;
    token: number;
    side: OrderSide;
    quantity: number;
    price: number;
    context?: TradeContext;
  }): Promise<TradeResponse> {
    await this.initialize();

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
        ai_reasoning: params.context?.aiReasoning || null,
        ai_confidence: params.context?.aiConfidence || null,
        vix_level: params.context?.vixLevel || null,
        rsi_level: params.context?.rsiLevel || null,
        trend_15m: params.context?.trend15m || null,
        ai_stop_loss: params.context?.aiStopLoss || null,
        ai_target: params.context?.aiTarget || null,
      }).catch(err => console.error("❌ Failed to save paper trade to DB:", err));
    }

    console.log(`📝 [PAPER TRADE] ${order.side} ${order.quantity}x ${order.symbol} @ ${order.price}`);
    
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
      } else {
        this.positions.set(order.symbol, {
          symbol: order.symbol,
          token: order.token,
          side: "BUY",
          quantity: order.quantity,
          avgEntryPrice: order.price!,
          currentPrice: order.price!,
          unrealizedPnL: 0,
          realizedPnL: 0,
          aiStopLoss: context?.aiStopLoss,
          aiTarget: context?.aiTarget,
          timestamp: new Date(),
        });
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
          await tradeRepo.closeTrade(targetTrade.id, order.price!).catch(err => console.error("❌ Failed to close trade in DB:", err));
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
              price: price
            });
          } else if (pos.aiTarget && price >= pos.aiTarget) {
            console.log(`[EXIT] Target reached for ${symbol} @ ${price} (Target: ${pos.aiTarget})`);
            await this.placeOrder({
              symbol: pos.symbol,
              token: pos.token,
              side: "SELL",
              quantity: pos.quantity,
              price: price
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
