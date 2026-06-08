import { EventEmitter } from "node:events"
import type { TradeOrder, PaperPosition, TradeResponse, OrderSide } from "./types.js"
import { tradeRepo } from "../db/repositories/trade-repo.js"
import { evaluatePosition } from "../analysis/trade.js"
import type { AIMacroTrend, TradingAgentType } from "../ai/types.js"
import { candleBuilder } from "../data/candle-builder.js"
import { getMultiTimeframeCandles } from "../data/yahoo.js"
import { getInstrumentToken } from "../data/kite.js"

export type StrategyContext = {
  macroTrend: AIMacroTrend
  isCompression?: boolean
  atr14?: number
  indexSl: number
  agentType: TradingAgentType
}

export interface TradeContext {
  aiReasoning?: string
  aiConfidence?: number
  vixLevel?: number
  rsiLevel?: number
  trend15m?: string
  aiStopLoss?: number
  aiTarget?: number
  aiStrike?: number
  aiSetup?: string
  strategyContext?: StrategyContext
}

export class PaperTrader extends EventEmitter {
  private positions: Map<string, PaperPosition> = new Map()
  private orders: TradeOrder[] = []
  private initialized = false
  private initializationPromise: Promise<void> | null = null
  private exitingPositions: Set<string> = new Set()
  private recentExits: Map<string, Date> = new Map()
  public maxConcurrentPositions = Number(process.env.MAX_PAPER_POSITIONS || 2)
  public entryCooldownMins = Number(process.env.ENTRY_COOLDOWN_MINS || 15)

  // Risk Management
  private maxDailyTrades = 20
  private todayRealizedPnL = 0
  private todayTradeCount = 0
  private tradingHalted = false

  constructor() {
    super()
  }

  async initialize() {
    if (this.initialized) return
    if (this.initializationPromise) return this.initializationPromise

    this.initializationPromise = (async () => {
      try {
        const [openTrades, todayTrades] = await Promise.all([tradeRepo.getOpenTrades(), tradeRepo.getTodaysTrades()])

        console.log(
          `[PaperTrader] Restoring ${openTrades.length} open trades and analyzing ${todayTrades.length} trades for today...`
        )

        // Initialize today's stats
        this.todayTradeCount = todayTrades.length
        this.todayRealizedPnL = todayTrades.reduce((acc, t) => acc + (t.pnl || 0), 0)
        console.log(`[PaperTrader] Today PnL from trades ${this.todayRealizedPnL}`)

        for (const trade of openTrades) {
          // Group by symbol to reconstruct positions
          const existing = this.positions.get(trade.symbol)
          if (existing) {
            const totalQty = existing.quantity + trade.quantity
            const totalCost = existing.avgEntryPrice * existing.quantity + trade.entry_price * trade.quantity
            existing.avgEntryPrice = totalCost / totalQty
            existing.quantity = totalQty
            if ((!existing.token || existing.token === 0) && trade.token) existing.token = trade.token
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
            }
            if (trade.strike_price) pos.strike = trade.strike_price
            if (trade.ai_stop_loss) pos.aiStopLoss = trade.ai_stop_loss
            if (trade.ai_target) pos.aiTarget = trade.ai_target

            this.positions.set(trade.symbol, pos)
          }
        }

        // Check if trading should be halted based on restored stats
        // Note: unrealizedPnL is 0 here until prices start ticking

        if (this.todayTradeCount >= this.maxDailyTrades) {
          console.log(`[PaperTrader] Trading halted on initialization. Trades: ${this.todayTradeCount}`)
          this.tradingHalted = true
        }

        this.initialized = true
        console.log("[PaperTrader] Initialization complete.")

        // Signal initialized with tokens so ticker can subscribe
        this.emit(
          "initialized",
          Array.from(this.positions.values())
            .map((p) => p.token)
            .filter((t) => !!t)
        )

        // Start market status monitoring
        this.startMarketMonitor()
        // Start AI position management
        this.startPositionManager()
      } catch (err) {
        console.error("[PaperTrader] Failed to initialize:", err)
      } finally {
        this.initializationPromise = null
      }
    })()

    return this.initializationPromise
  }

  private startMarketMonitor() {
    setInterval(() => {
      this.checkMarketStatus()
    }, 60 * 1000) // Check every minute
  }

  private startPositionManager() {
    const intervalMins = Number(process.env.POSITION_EVAL_INTERVAL_MINS || 3)
    console.log(`[Risk Manager] Starting periodic position re-evaluation every ${intervalMins} minutes...`)

    setInterval(
      async () => {
        const positions = this.getAllPositions()
        if (positions.length === 0) return

        console.log(`[Risk Manager] Re-evaluating ${positions.length} active positions...`)

        for (const pos of positions) {
          try {
            // Identify underlying symbol (e.g., from NIFTY24MAY24100CE to NIFTY)
            const symbol = pos.symbol.startsWith("NIFTY")
              ? "NIFTY"
              : pos.symbol.startsWith("BANKNIFTY")
                ? "BANKNIFTY"
                : pos.symbol

            const macroSymbol = symbol === "NIFTY" ? "^NSEI" : "^NSEBANK"
            const [macro, underlyingToken] = await Promise.all([
              getMultiTimeframeCandles(macroSymbol),
              getInstrumentToken(symbol)
            ])

            const { decision, marketData, agentType } = await evaluatePosition(symbol, pos, {
              candles1d: macro.candles1d,
              candles1h: macro.candles1h,
              candles30m: candleBuilder.getCandles(underlyingToken || 0, 30),
              candles15m: candleBuilder.getCandles(underlyingToken || 0, 15),
              candles3m: candleBuilder.getCandles(underlyingToken || 0, 3),
            })

            // Update stored agent type if upgraded
            if (!pos.strategyContext) pos.strategyContext = {}
            if (pos.strategyContext.agentType !== agentType) {
              console.log(`[Risk Manager] Agent for ${pos.symbol} updated to ${agentType}`)
              pos.strategyContext.agentType = agentType
            }

            if (decision.decision === "EXIT") {
              console.log(
                `[Risk Manager] AI (${agentType} Agent) signaled EXIT for ${pos.symbol}. Reason: ${decision.reason}`
              )
              await this.placeOrder({
                symbol: pos.symbol,
                token: pos.token,
                side: "SELL",
                quantity: pos.quantity,
                price: pos.currentPrice,
                context: { aiReasoning: decision.reason },
              })
            } else if (decision.decision === "UPDATE_SL" && decision.newIndexStopLoss) {
              // TRANSLATE INDEX TRAILING STOP TO PREMIUM
              const currentIndexPrice = marketData.tf15m.price

              // Logic: Calculate how many points the Index SL moved, then apply delta to Option Premium
              const indexRiskPoints = Math.abs(currentIndexPrice - decision.newIndexStopLoss)

              // TREND Agent uses wider stops / different multiplier if needed
              // Trend trades often use deep ITM or further ATM, so delta varies.
              // For TREND, we assume a slightly lower delta to give it more breathing room on premium swings.
              const estimatedDelta = agentType === "TREND" ? 0.45 : 0.6
              const optionRiskPoints = indexRiskPoints * estimatedDelta

              let newPremiumSl = pos.currentPrice - optionRiskPoints

              // Base target calculation
              let newPremiumTarget = pos.currentPrice + optionRiskPoints * (decision.riskRewardRatio || 2.0)

              // TREND agents should let winners run: expand the target aggressively
              if (agentType === "TREND") {
                newPremiumTarget =
                  pos.currentPrice +
                  optionRiskPoints * (decision.riskRewardRatio ? decision.riskRewardRatio * 1.5 : 4.0)
              }

              // Dynamic Target Trailing: Only update target if it moves higher (never shrink the target)
              if (pos.aiTarget && newPremiumTarget < pos.aiTarget) {
                newPremiumTarget = pos.aiTarget
              } else {
                pos.aiTarget = newPremiumTarget
              }

              // SAFETY FLOOR: Prevent negative SL
              // TREND agent is allowed more breathing room to avoid SL hunting
              const floorPercentage = agentType === "TREND" ? 0.02 : 0.2 // Minimal floor for TREND to stay in the game
              const minAllowedSl = Math.max(pos.currentPrice * floorPercentage, 0.05)

              if (newPremiumSl < minAllowedSl) {
                console.warn(
                  `[Risk Manager] Capping SL for ${pos.symbol} at ${agentType} safety floor: ${minAllowedSl.toFixed(2)}`
                )
                newPremiumSl = minAllowedSl
              }

              console.log(
                `[Risk Manager] AI (${agentType} Agent) signaled UPDATE_SL for ${pos.symbol}. Index SL: ${decision.newIndexStopLoss} -> Premium SL: ${newPremiumSl.toFixed(2)}`
              )

              pos.aiStopLoss = newPremiumSl
              pos.aiTarget = newPremiumTarget

              this.emit("notification", {
                title: `🛡️ Trailing SL (${agentType})`,
                message: `${pos.symbol}: SL moved to ${newPremiumSl.toFixed(2)}`,
                type: "info",
              })
            }
          } catch (err) {
            console.error(`[Risk Manager] Failed to re-evaluate position ${pos.symbol}:`, err)
          }
        }
      },
      intervalMins * 60 * 1000
    )
  }

  private checkMarketStatus() {
    const istTime = new Date().toLocaleTimeString("en-IN", {
      timeZone: "Asia/Kolkata",
      hour12: false,
    })
    const [hours, minutes] = istTime.split(":").map(Number)

    // 1. Square-off at 3:25 PM IST (15:25)
    if (hours === 15 && minutes === 25) {
      const positions = this.getAllPositions()
      if (positions.length > 0) {
        console.log(`[EXIT] 15:25 IST - Market Square-off triggered for ${positions.length} positions.`)
        this.squareOffAll()
      }
    }

    // 2. Market Close at 3:30 PM IST (15:30)
    if (hours === 15 && minutes === 30) {
      console.log("[EXIT] 15:30 IST - Market Closed. Emitting shutdown signal.")
      this.emit("market_close")
    }
  }

  async squareOffAll() {
    const positions = this.getAllPositions()
    for (const pos of positions) {
      if (this.exitingPositions.has(pos.symbol)) continue

      await this.placeOrder({
        symbol: pos.symbol,
        token: pos.token,
        side: "SELL",
        quantity: pos.quantity,
        price: pos.currentPrice,
        context: { aiReasoning: "Market Square-off" },
      })
    }
  }

  async placeOrder(params: {
    symbol: string
    token: number
    strike?: number
    side: OrderSide
    quantity: number
    price: number
    context?: TradeContext
  }): Promise<TradeResponse> {
    await this.initialize()

    if (params.side === "BUY") {
      // 0. Check Daily Limits & Halt Status
      if (this.tradingHalted) {
        console.log(`❌ [PAPER TRADE] Trading halted for the day (Limits reached). Skipping ${params.symbol}`)
        return { success: false, error: "Trading halted for the day (Limits reached)" }
      }

      if (this.todayTradeCount >= this.maxDailyTrades) {
        console.log(`❌ [PAPER TRADE] Maximum daily trades reached (${this.maxDailyTrades}). Skipping ${params.symbol}`)
        return { success: false, error: "Maximum daily trades reached" }
      }

      // 1. Check Max Concurrent Positions
      if (this.positions.size >= this.maxConcurrentPositions) {
        const msg = `❌ [PAPER TRADE] Limit reached: ${this.positions.size}/${this.maxConcurrentPositions} active positions. Skipping ${params.symbol}`
        console.log(msg)
        return { success: false, error: "Maximum concurrent positions reached" }
      }

      // 2. Check if already have a position for this symbol
      if (this.positions.has(params.symbol)) {
        const msg = `❌ [PAPER TRADE] Position already exists for ${params.symbol}. Skipping duplicate entry.`
        console.log(msg)
        return { success: false, error: "Position already exists for this symbol" }
      }

      // 3. Check if already have a position for this strike level
      const strike = params.strike || params.context?.aiStrike
      if (strike) {
        const existingStrike = Array.from(this.positions.values()).find((p) => p.strike === strike)
        if (existingStrike) {
          const msg = `❌ [PAPER TRADE] Position already exists for strike ${strike} (${existingStrike.symbol}). Skipping duplicate level entry.`
          console.log(msg)
          return { success: false, error: `Position already exists for strike ${strike}` }
        }

        // 4. CHECK COOLDOWN (PREVENT RE-ENTRY)
        const exitKey = `${params.symbol}_${strike}`
        const lastExit = this.recentExits.get(exitKey)
        if (lastExit) {
          const diffMs = new Date().getTime() - lastExit.getTime()
          const diffMins = diffMs / (60 * 1000)
          if (diffMins < this.entryCooldownMins) {
            const msg = `⏳ [PAPER TRADE] Re-entry blocked for ${params.symbol} (Strike: ${strike}). Cooldown: ${diffMins.toFixed(1)}/${this.entryCooldownMins} mins.`
            console.log(msg)
            return { success: false, error: "Re-entry cooldown active" }
          }
        }
      }

      // 5. Fixed Position Sizing (1 Lot Only)
      // Standard lot sizes: NIFTY = 65, BANKNIFTY = 15
      const lotSize = params.symbol.includes("BANKNIFTY") ? 15 : 65
      
      params.quantity = lotSize
      this.todayTradeCount++
    }

    if (params.side === "SELL") {
      if (this.exitingPositions.has(params.symbol)) {
        console.log(`⚠️ [PAPER TRADE] Exit already in progress for ${params.symbol}. Skipping duplicate exit.`)
        return { success: false, error: "Exit already in progress" }
      }
      this.exitingPositions.add(params.symbol)

      // Record exit for cooldown
      const strike = params.strike || this.positions.get(params.symbol)?.strike
      if (strike) {
        this.recentExits.set(`${params.symbol}_${strike}`, new Date())
      }
    }

    const orderId = `paper_${Math.random().toString(36).substr(2, 9)}`

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
    }
    const strike = params.strike || params.context?.aiStrike
    if (strike) order.strike = strike

    this.orders.push(order)
    await this.updatePosition(order, params.context)

    // PERSIST TO DATABASE
    if (order.side === "BUY") {
      await tradeRepo
        .insertTrade({
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
        })
        .catch((err) => console.error("❌ Failed to save paper trade to DB:", err))
    }

    console.log(`📝 [PAPER TRADE] ${order.side} ${order.quantity}x ${order.symbol} @ ${order.price}`)

    // Safety check: If AI provides an invalid SL (higher than entry for a BUY),
    // we should invalidate that SL to prevent an immediate exit loop.
    // NOTE: We must first check if the SL is an INDEX level (> 1000) and translate it to PREMIUM.
    const pos = this.positions.get(order.symbol)
    if (pos && pos.side === "BUY") {
      // 1. Detect and translate index-level SL
      if (pos.aiStopLoss !== undefined && pos.aiStopLoss > 1000) {
        const fallbackOffset = pos.side === "BUY" ? 50 : -50
        const indexPrice = params.context?.strategyContext?.indexSl || (pos.aiStopLoss + fallbackOffset)
        const indexRisk = Math.abs(indexPrice - pos.aiStopLoss)
        const agentType = params.context?.strategyContext?.agentType || "SCALPER"
        const delta = agentType === "TREND" ? 0.45 : 0.6
        const premiumRisk = indexRisk * delta
        
        const oldSl = pos.aiStopLoss
        pos.aiStopLoss = Math.max(order.price! - premiumRisk, 0.05)
        console.log(`[PAPER TRADE] Translated Index SL ${oldSl} to Premium SL ${pos.aiStopLoss.toFixed(2)} (Risk: ${premiumRisk.toFixed(2)})`)
      }

      // 2. Detect and translate index-level Target
      if (pos.aiTarget !== undefined && pos.aiTarget > 1000) {
        const fallbackOffset = pos.side === "BUY" ? -100 : 100
        const indexPrice = params.context?.strategyContext?.indexSl || (pos.aiTarget + fallbackOffset)
        const indexGain = Math.abs(pos.aiTarget - indexPrice)
        const agentType = params.context?.strategyContext?.agentType || "SCALPER"
        const delta = agentType === "TREND" ? 0.45 : 0.6
        const premiumGain = indexGain * delta
        
        const oldTarget = pos.aiTarget
        pos.aiTarget = order.price! + premiumGain
        console.log(`[PAPER TRADE] Translated Index Target ${oldTarget} to Premium Target ${pos.aiTarget.toFixed(2)} (Gain: ${premiumGain.toFixed(2)})`)
      }

      if (pos.aiStopLoss !== undefined && pos.aiStopLoss >= order.price!) {
        console.warn(
          `⚠️ [PAPER TRADE] Invalid SL (${pos.aiStopLoss}) for BUY at ${order.price}. Disabling SL for this position to prevent immediate exit.`
        )
        delete pos.aiStopLoss
      }
      if (pos.aiTarget !== undefined && pos.aiTarget <= order.price!) {
        console.warn(
          `⚠️ [PAPER TRADE] Invalid Target (${pos.aiTarget}) for BUY at ${order.price}. Disabling Target for this position.`
        )
        delete pos.aiTarget
      }
    }

    // Determine notification details
    let title = order.side === "BUY" ? "🚀 Trade Executed" : "✅ Position Closed"
    let type = order.side === "BUY" ? "success" : "info"

    if (order.side === "SELL") {
      const existing = this.positions.get(order.symbol)
      if (existing) {
        if (existing.aiStopLoss && order.price! <= existing.aiStopLoss) {
          title = "🛑 Stop-Loss Hit"
          type = "error"
        } else if (existing.aiTarget && order.price! >= existing.aiTarget) {
          title = "🎯 Target Reached"
          type = "success"
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
        target: params.context?.aiTarget || this.positions.get(order.symbol)?.aiTarget,
      },
    })

    this.emit("order_update", order)
    this.emit("portfolio_update", this.getAllPositions())

    if (params.side === "SELL") {
      this.exitingPositions.delete(params.symbol)
    }

    return { success: true, orderId }
  }

  private async updatePosition(order: TradeOrder, context?: TradeContext) {
    const existing = this.positions.get(order.symbol)

    if (order.side === "BUY") {
      if (existing) {
        const totalQty = existing.quantity + order.quantity
        const totalCost = existing.avgEntryPrice * existing.quantity + order.price! * order.quantity
        existing.avgEntryPrice = totalCost / totalQty
        existing.quantity = totalQty
        // Update SL/Target if new context provided
        if (context?.aiStopLoss) existing.aiStopLoss = context.aiStopLoss
        if (context?.aiTarget) existing.aiTarget = context.aiTarget
        if (order.strike) existing.strike = order.strike
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
        }
        if (order.strike) pos.strike = order.strike
        if (context?.aiStopLoss) pos.aiStopLoss = context.aiStopLoss
        if (context?.aiTarget) pos.aiTarget = context.aiTarget
        if (context?.aiSetup) pos.aiSetup = context.aiSetup
        if (context?.strategyContext) pos.strategyContext = context.strategyContext

        this.positions.set(order.symbol, pos)
      }
    } else {
      // Simple SELL logic: Close position
      if (existing) {
        const pnl = (order.price! - existing.avgEntryPrice) * order.quantity
        existing.realizedPnL += pnl
        this.todayRealizedPnL += pnl
        existing.quantity -= order.quantity

        // DB: We'll need to find the correct trade ID.
        // For now, let's assume we find the most recent open trade for this symbol.
        const openTrades = await tradeRepo.getOpenTrades()
        const targetTrade = openTrades.find((t) => t.symbol === order.symbol)
        if (targetTrade) {
          await tradeRepo
            .closeTrade(targetTrade.id, order.price!, context?.aiReasoning)
            .catch((err) => console.error("❌ Failed to close trade in DB:", err))
        } else {
          console.warn(`⚠️ [DB SYNC ISSUE] Could not find OPEN trade in database for ${order.symbol} to close it.`)
        }

        if (existing.quantity <= 0) {
          this.positions.delete(order.symbol)
        }
      }
    }
  }

  async updatePrice(token: number, price: number) {
    if (!this.initialized) await this.initialize()

    let changed = false
    let currentUnrealized = 0

    for (const [symbol, pos] of this.positions) {
      if (pos.token === token) {
        pos.currentPrice = price
        pos.unrealizedPnL = (price - pos.avgEntryPrice) * pos.quantity
        changed = true

        // Automated Exit Monitoring
        if (pos.side === "BUY" && !this.exitingPositions.has(symbol)) {
          if (pos.aiStopLoss && price <= pos.aiStopLoss) {
            console.log(`[EXIT] Stop-Loss hit for ${symbol} @ ${price} (SL: ${pos.aiStopLoss})`)
            await this.placeOrder({
              symbol: pos.symbol,
              token: pos.token,
              side: "SELL",
              quantity: pos.quantity,
              price: price,
              context: { aiReasoning: "Stop-Loss hit" },
            })
          } else if (pos.aiTarget && price >= pos.aiTarget) {
            console.log(`[EXIT] Target reached for ${symbol} @ ${price} (Target: ${pos.aiTarget})`)
            await this.placeOrder({
              symbol: pos.symbol,
              token: pos.token,
              side: "SELL",
              quantity: pos.quantity,
              price: price,
              context: { aiReasoning: "Target reached" },
            })
          }
        }
      }
      currentUnrealized += pos.unrealizedPnL
    }

    if (changed) {
      this.emit("pnl_update", this.getAllPositions())
    }
  }

  getAllPositions(): PaperPosition[] {
    return Array.from(this.positions.values())
  }

  getOrders(): TradeOrder[] {
    return this.orders
  }
}

// Singleton for easy access across the app
export const paperTrader = new PaperTrader()
