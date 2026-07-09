import { EventEmitter } from 'node:events'
import type { TradeOrder, PaperPosition, TradeResponse, OrderSide } from './types.js'
import { tradeRepo } from '../db/repositories/container.js'
import { evaluatePosition } from '../analysis/trade.js'
import type { AIMacroTrend, TradingAgentType } from '../ai/types.js'
import { eventHub } from '../utils/event-hub.js'
import { candleBuilder, seedCandleBuilder } from '../data/candle-builder.js'
import { getMultiTimeframeCandles } from '../data/yahoo.js'
import { getInstrumentToken } from '../data/kite.js'
import type { Connect as KiteConnect } from 'kiteconnect'
import { KiteOrderService } from './kite-orders.js'
import { getGreeksFromPrice } from '../analysis/greeks.js'
import { resolveYahooTicker } from '../utils/symbol.js'
import { computeTieredTargets } from './tier-calculator.js'

export type StrategyContext = {
  macroTrend: AIMacroTrend
  isCompression?: boolean
  atr14?: number
  indexSl: number
  agentType: TradingAgentType
  reversalScore?: { bullish: number; bearish: number }
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
  optionDelta?: number
  optionTheta?: number
  optionVega?: number
  optionExpiry?: Date | string
  lotSize?: number
  /** AI wave/Fibonacci index-level targets from decision.targets[] — used for tier calculation. */
  aiIndexTargets?: number[]
  /** Live index price at time of entry — used to translate index targets to premium */
  currentIndexPrice?: number
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
  private inFlightOrders: Set<string> = new Set()

  private marketMonitorTimer?: NodeJS.Timeout
  private positionManagerTimer?: NodeJS.Timeout

  // Risk Management
  private maxDailyTrades = 20
  private maxDailyLoss = Number(process.env.MAX_DAILY_LOSS || -20000)
  private todayRealizedPnL = 0
  private todayTradeCount = 0
  private tradingHalted = false

  private userId: string
  private kc: KiteConnect
  private kiteOrderService: KiteOrderService
  public tradeMode: 'PAPER' | 'REAL' = 'PAPER'

  constructor(userId: string, kc: KiteConnect) {
    super()
    this.userId = userId
    this.kc = kc
    if (kc) {
      this.kiteOrderService = new KiteOrderService(kc)
    } else {
      this.kiteOrderService = null as any
    }
  }

  public setKiteClient(kc: KiteConnect) {
    this.kc = kc
    if (kc) {
      this.kiteOrderService = new KiteOrderService(kc)
    }
  }

  public setTradeMode(mode: 'PAPER' | 'REAL') {
    this.tradeMode = mode
    console.log(`[PaperTrader ${this.userId}] Trade mode set to ${mode}`)
  }

  async initialize() {
    if (this.initialized) return
    if (this.initializationPromise) return this.initializationPromise

    this.initializationPromise = (async () => {
      try {
        const [openTrades, todayTrades] = await Promise.all([
          tradeRepo.getOpenTrades(this.userId),
          tradeRepo.getTodaysTrades(this.userId),
        ])

        console.log(
          `[PaperTrader ${this.userId}] Restoring ${openTrades.length} open trades and analyzing ${todayTrades.length} trades for today...`
        )

        // Initialize today's stats
        this.todayTradeCount = todayTrades.length
        this.todayRealizedPnL = todayTrades.reduce((acc, t) => acc + (Number(t.pnl) || 0), 0)
        console.log(`[PaperTrader] Today PnL from trades ${this.todayRealizedPnL}`)

        for (const trade of openTrades) {
          // Group by symbol to reconstruct positions
          const existing = this.positions.get(trade.symbol)
          if (existing) {
            const totalQty = existing.quantity + trade.quantity
            const totalCost =
              Number(existing.avgEntryPrice) * existing.quantity + Number(trade.entryPrice) * trade.quantity
            existing.avgEntryPrice = totalCost / totalQty
            existing.quantity = totalQty
            if ((!existing.token || existing.token === 0) && trade.instrumentToken)
              existing.token = trade.instrumentToken
          } else {
            const pos: PaperPosition = {
              symbol: trade.symbol,
              token: trade.instrumentToken || 0,
              side: trade.side,
              quantity: trade.quantity,
              avgEntryPrice: Number(trade.entryPrice),
              currentPrice: Number(trade.entryPrice),
              unrealizedPnL: 0,
              realizedPnL: 0,
              timestamp: new Date(trade.openedAt),
            }
            if (trade.strikePrice) pos.strike = Number(trade.strikePrice)

            // Note: In Supabase schema, AI metadata is stored in tradeAnalytics, so we can't restore it perfectly
            // from trades table alone without an inner join. For now, we omit it on restore or handle it later.

            this.positions.set(trade.symbol, pos)
          }
        }

        // Check if trading should be halted based on restored stats
        // Note: unrealizedPnL is 0 here until prices start ticking

        if (this.todayTradeCount >= this.maxDailyTrades || this.todayRealizedPnL <= this.maxDailyLoss) {
          console.log(
            `[PaperTrader] Trading halted on initialization. Trades: ${this.todayTradeCount}, PnL: ${this.todayRealizedPnL}`
          )
          this.tradingHalted = true
        }

        this.initialized = true
        console.log('[PaperTrader] Initialization complete.')

        // Signal initialized with tokens so ticker can subscribe
        this.emit(
          'initialized',
          Array.from(this.positions.values())
            .map((p) => p.token)
            .filter((t) => !!t)
        )

        // Start market status monitoring
        this.startMarketMonitor()
        // Start AI position management
        this.startPositionManager()
      } catch (err) {
        console.error('[PaperTrader] Failed to initialize:', err)
        throw err
      } finally {
        this.initializationPromise = null
      }
    })()

    return this.initializationPromise
  }

  private startMarketMonitor() {
    if (this.marketMonitorTimer) clearInterval(this.marketMonitorTimer)
    this.marketMonitorTimer = setInterval(() => {
      this.checkMarketStatus()
    }, 60 * 1000) // Check every minute
  }

  private startPositionManager() {
    const intervalMins = Number(process.env.POSITION_EVAL_INTERVAL_MINS || 1)
    console.log(`[Risk Manager] Starting periodic position re-evaluation every ${intervalMins} minutes...`)

    if (this.positionManagerTimer) clearInterval(this.positionManagerTimer)
    this.positionManagerTimer = setInterval(
      async () => {
        const positions = this.getAllPositions()
        if (positions.length === 0) {
          eventHub.emit('agent_update', {
            agent: 'Risk Manager',
            status: 'idle',
            message: 'No active positions.',
            data: {
              reason: 'Waiting for the AI agents to execute a new trade. Risk limits are reset and ready.',
            },
          })
          return
        }

        eventHub.emit('agent_update', {
          agent: 'Risk Manager',
          status: 'thinking',
          message: `Re-evaluating ${positions.length} active position(s)...`,
          data: {
            rationale: `Analyzing live market data and computing updated Greeks for ${positions.length} open position(s)...`,
          },
        })

        console.log(`\n[Risk Manager] Re-evaluating ${positions.length} active positions...`)

        for (const pos of positions) {
          try {
            // Identify underlying symbol (e.g., from NIFTY24MAY24100CE to NIFTY)
            const symbol = pos.symbol.startsWith('NIFTY')
              ? 'NIFTY'
              : pos.symbol.startsWith('BANKNIFTY')
                ? 'BANKNIFTY'
                : pos.symbol

            const [macro, underlyingToken] = await Promise.all([
              getMultiTimeframeCandles(symbol, this.kc),
              getInstrumentToken(this.kc, symbol),
            ])

            if (underlyingToken) {
              await seedCandleBuilder(this.kc, underlyingToken)
            }

            const { decision, marketData, agentType } = await evaluatePosition(
              this.kc,
              symbol,
              pos,
              {
                candles1d: macro.candles1d,
                candles1h: macro.candles1h,
                candles30m: candleBuilder.getCandles(underlyingToken || 0, 30),
                candles15m: candleBuilder.getCandles(underlyingToken || 0, 15),
                candles3m: candleBuilder.getCandles(underlyingToken || 0, 3),
              },
              this.userId
            )

            // Calculate Greeks dynamically
            if (pos.optionExpiry && pos.strike && (pos.symbol.endsWith('CE') || pos.symbol.endsWith('PE'))) {
              const expiryTime = new Date(pos.optionExpiry).getTime()
              const now = Date.now()
              const daysToExpiry = Math.max(0, (expiryTime - now) / (1000 * 60 * 60 * 24))
              const type = pos.symbol.endsWith('CE') ? 'CE' : 'PE'

              const greeks = getGreeksFromPrice(
                pos.currentPrice,
                marketData.tf15m.price,
                pos.strike,
                daysToExpiry,
                0.07,
                type
              )

              if (greeks) {
                pos.optionDelta = greeks.delta
                pos.optionTheta = greeks.theta
                pos.optionVega = greeks.vega
              }
            }

            // Update stored agent type if upgraded
            if (!pos.strategyContext) pos.strategyContext = {}
            if (pos.strategyContext.agentType !== agentType) {
              console.log(`[Risk Manager] Agent for ${pos.symbol} updated to ${agentType}`)
              pos.strategyContext.agentType = agentType
            }

            if (decision.decision === 'EXIT') {
              console.log(
                `[Risk Manager] AI (${agentType} Agent) signaled EXIT for ${pos.symbol}. Reason: ${decision.reason}`
              )
              await this.placeOrder({
                symbol: pos.symbol,
                token: pos.token,
                side: 'SELL',
                quantity: pos.quantity,
                price: pos.currentPrice,
                context: { aiReasoning: decision.reason },
              })
            } else if (decision.decision === 'UPDATE_SL' && decision.newIndexStopLoss) {
              const currentIndexPrice = marketData.tf15m.price

              // AI mistake protection: if the index SL is < 1000, it's a premium price
              let newPremiumSl
              let optionRiskPoints

              if (decision.newIndexStopLoss < 1000) {
                console.warn(
                  `[Risk Manager] AI returned a premium SL instead of an Index SL: ${decision.newIndexStopLoss}. Using it directly.`
                )
                newPremiumSl = decision.newIndexStopLoss
                optionRiskPoints = Math.abs(pos.currentPrice - newPremiumSl)
              } else {
                // TRANSLATE INDEX TRAILING STOP TO PREMIUM
                const indexRiskPoints = Math.abs(currentIndexPrice - decision.newIndexStopLoss)

                // Calculate Risk Points using the exact Black-Scholes Delta if available, otherwise fallback to estimation
                // Delta is negative for PE, so we take the absolute value
                const dynamicDelta = pos.optionDelta ? Math.abs(pos.optionDelta) : agentType === 'TREND' ? 0.45 : 0.6

                // For TREND agent, we can apply a small buffer to prevent premature shakeouts due to gamma spikes.
                const effectiveDelta =
                  agentType === 'TREND' ? Math.max(0.1, dynamicDelta * 0.9) : Math.max(0.1, dynamicDelta)

                optionRiskPoints = indexRiskPoints * effectiveDelta

                newPremiumSl = pos.currentPrice - optionRiskPoints
              }

              // Base target calculation
              let newPremiumTarget = pos.currentPrice + optionRiskPoints * (decision.riskRewardRatio || 2.0)

              // TREND agents should let winners run: expand the target aggressively
              if (agentType === 'TREND') {
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
              const floorPercentage = agentType === 'TREND' ? 0.02 : 0.2 // Minimal floor for TREND to stay in the game
              const minAllowedSl = Math.max(pos.currentPrice * floorPercentage, 0.05)

              if (newPremiumSl < minAllowedSl) {
                console.warn(
                  `[Risk Manager] Capping SL for ${pos.symbol} at ${agentType} safety floor: ${minAllowedSl.toFixed(2)}`
                )
                newPremiumSl = minAllowedSl
              }

              // ONE-WAY RATCHET: Stop-Loss can only go UP
              if (pos.aiStopLoss !== undefined && newPremiumSl <= pos.aiStopLoss) {
                console.log(
                  `[Risk Manager] Ignoring calculated SL (${newPremiumSl.toFixed(2)}) as it is lower than or equal to current SL (${pos.aiStopLoss.toFixed(2)}) for ${pos.symbol}.`
                )
              } else {
                console.log(
                  `[Risk Manager] AI (${agentType} Agent) signaled UPDATE_SL for ${pos.symbol}. Index SL: ${decision.newIndexStopLoss} -> Premium SL: ${newPremiumSl.toFixed(2)}`
                )
                pos.aiStopLoss = newPremiumSl

                this.emit('notification', {
                  title: `🛡️ Trailing SL (${agentType})`,
                  message: `${pos.symbol}: SL moved to ${newPremiumSl.toFixed(2)}`,
                  type: 'info',
                })
              }

              pos.aiTarget = newPremiumTarget
            }
          } catch (err) {
            console.error(`[Risk Manager] Failed to re-evaluate position ${pos.symbol}:`, err)
          }
        }

        // --- Greeks Dashboard ---
        console.log('-------------------------------------------------------------------------------------------------')
        console.log('📈 LIVE GREEKS DASHBOARD')
        console.table(
          positions.map((p) => ({
            Symbol: p.symbol,
            Qty: p.quantity,
            LTP: p.currentPrice.toFixed(2),
            PnL: p.unrealizedPnL >= 0 ? `+${p.unrealizedPnL.toFixed(2)}` : p.unrealizedPnL.toFixed(2),
            Delta: p.optionDelta ? (p.optionDelta * p.quantity).toFixed(2) : 'N/A',
            Theta: p.optionTheta ? (p.optionTheta * p.quantity).toFixed(2) : 'N/A',
            Vega: p.optionVega ? (p.optionVega * p.quantity).toFixed(2) : 'N/A',
            'Burn/Day': p.optionTheta ? `₹${Math.abs(p.optionTheta * p.quantity).toFixed(2)}` : 'N/A',
          }))
        )
        console.log(
          '-------------------------------------------------------------------------------------------------\n'
        )

        eventHub.emit('agent_update', {
          agent: 'Risk Manager',
          status: 'decided',
          message: `Positions managed. Holding ${positions.length} active position(s).`,
          data: {
            rationale: `Risk evaluation completed for ${positions.length} positions. Checked trailing stops, targets, and live Greeks (Delta, Theta, Vega) based on recent market action.`,
            reason: `Evaluated ${positions.length} positions to ensure no predefined risk limits were breached.`,
          },
        })
      },
      intervalMins * 60 * 1000
    )
  }

  private checkMarketStatus() {
    const istTime = new Date().toLocaleTimeString('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour12: false,
    })
    const [hours, minutes] = istTime.split(':').map(Number)

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
      console.log('[EXIT] 15:30 IST - Market Closed. Emitting shutdown signal.')
      this.emit('market_close')
    }
  }

  async squareOffAll(reason: string = 'Market Square-off') {
    const positions = this.getAllPositions()
    for (const pos of positions) {
      if (this.exitingPositions.has(pos.symbol)) continue

      await this.placeOrder({
        symbol: pos.symbol,
        token: pos.token,
        side: 'SELL',
        quantity: pos.quantity,
        price: pos.currentPrice,
        context: { aiReasoning: reason },
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

    const lockKey = `${params.side}_${params.symbol}_${params.strike || 'ANY'}`
    if (this.inFlightOrders.has(lockKey)) {
      console.log(`❌ [PAPER TRADE] Order already in-flight for ${lockKey}. Rejecting duplicate.`)
      return { success: false, error: 'Order already in progress' }
    }
    this.inFlightOrders.add(lockKey)

    try {
      if (params.side === 'BUY') {
        // 0. Check Daily Limits & Halt Status
        if (this.todayRealizedPnL <= this.maxDailyLoss) {
          this.tradingHalted = true
        }
        if (this.tradingHalted) {
          console.log(`❌ [PAPER TRADE] Trading halted for the day (Limits reached). Skipping ${params.symbol}`)
          return { success: false, error: 'Trading halted for the day (Limits reached)' }
        }

        if (this.todayTradeCount >= this.maxDailyTrades) {
          console.log(
            `❌ [PAPER TRADE] Maximum daily trades reached (${this.maxDailyTrades}). Skipping ${params.symbol}`
          )
          return { success: false, error: 'Maximum daily trades reached' }
        }

        // 1. Check Max Concurrent Positions
        if (this.positions.size >= this.maxConcurrentPositions) {
          const msg = `❌ [PAPER TRADE] Limit reached: ${this.positions.size}/${this.maxConcurrentPositions} active positions. Skipping ${params.symbol}`
          console.log(msg)
          return { success: false, error: 'Maximum concurrent positions reached' }
        }

        // 2. Check if already have a position for this symbol
        if (this.positions.has(params.symbol)) {
          const msg = `❌ [PAPER TRADE] Position already exists for ${params.symbol}. Skipping duplicate entry.`
          console.log(msg)
          return { success: false, error: 'Position already exists for this symbol' }
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
              return { success: false, error: 'Re-entry cooldown active' }
            }
          }
        }

        // Standard lot sizes
        const baseLotSize = params.context?.lotSize || 1

        let numLots = 1
        if (params.context?.optionDelta) {
          const delta = Math.abs(params.context.optionDelta)
          const targetDeltaExposure = 0.5 // We target the exposure of 1 ATM lot
          if (delta > 0) {
            numLots = Math.max(1, Math.round(targetDeltaExposure / delta))
          }
        }

        const MAX_LOTS = 4
        if (numLots > MAX_LOTS) {
          console.warn(
            `⚠️ [RISK CAP] Delta-Adjusted Sizing: ${numLots} lots exceeds max cap of ${MAX_LOTS} lots. Capping to ${MAX_LOTS}.`
          )
          numLots = MAX_LOTS
        }

        // Confidence-tiered sizing: 60-75% confidence = reduced to 1 lot
        if (params.context?.aiConfidence !== undefined) {
          const conf =
            params.context.aiConfidence <= 1.0 ? params.context.aiConfidence * 100 : params.context.aiConfidence
          if (conf >= 60 && conf < 75 && numLots > 1) {
            console.log(
              `⚖️ [CONFIDENCE TIER] Moderate confidence (${conf.toFixed(0)}%) — reducing from ${numLots} lots to 1 lot.`
            )
            numLots = 1
          }
        }

        params.quantity = baseLotSize * numLots
        if (numLots > 1) {
          console.log(
            `⚖️ Sizing: Delta=${Math.abs(params.context?.optionDelta || 0).toFixed(2)} -> Buying ${numLots} lots (${params.quantity} qty) with lot size ${baseLotSize}.`
          )
        } else {
          console.log(`⚖️ Sizing: Buying 1 lot (${params.quantity} qty) with lot size ${baseLotSize}.`)
        }
        this.todayTradeCount++
      }

      if (params.side === 'SELL') {
        if (this.exitingPositions.has(params.symbol)) {
          console.log(`⚠️ [PAPER TRADE] Exit already in progress for ${params.symbol}. Skipping duplicate exit.`)
          return { success: false, error: 'Exit already in progress' }
        }
        this.exitingPositions.add(params.symbol)

        // Record exit for cooldown
        const strike = params.strike || this.positions.get(params.symbol)?.strike
        if (strike) {
          this.recentExits.set(`${params.symbol}_${strike}`, new Date())
        }
      }

      // LIVE TRADE EXECUTION
      if (this.tradeMode === 'REAL') {
        console.log(`⚡ [LIVE TRADE] Placing real order for ${params.quantity}x ${params.symbol} (${params.side})`)
        const liveOrder = await this.kiteOrderService.placeOrder({
          symbol: params.symbol,
          side: params.side,
          quantity: params.quantity,
          type: 'MARKET',
          price: params.price,
        })

        if (!liveOrder.success) {
          console.error(`❌ [LIVE TRADE] Failed to place order: ${liveOrder.error}`)
          if (params.side === 'SELL') {
            this.exitingPositions.delete(params.symbol) // Rollback exit state
          }
          return { success: false, error: liveOrder.error }
        }

        console.log(`✅ [LIVE TRADE] Order Placed! ID: ${liveOrder.orderId}`)
      }

      const orderId = `paper_${Math.random().toString(36).substr(2, 9)}`

      const order: TradeOrder = {
        id: orderId,
        symbol: params.symbol,
        token: params.token,
        side: params.side,
        quantity: params.quantity,
        price: params.price,
        type: 'MARKET',
        status: 'COMPLETE',
        timestamp: new Date(),
      }
      const strike = params.strike || params.context?.aiStrike
      if (strike) order.strike = strike

      this.orders.push(order)
      await this.updatePosition(order, params.context)

      if (order.side === 'BUY') {
        this.emit('notification', {
          title: `🎯 Trade Entered`,
          message: `Bought ${order.quantity}x ${order.symbol} @ ₹${order.price}`,
          type: 'success',
        })
      }

      // PERSIST TO DATABASE
      if (order.side === 'BUY') {
        await tradeRepo
          .insertTrade({
            userId: this.userId,
            symbol: order.symbol,
            token: order.token,
            side: 'BUY',
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
            setup: params.context?.aiSetup || null,
            strategy_context: params.context?.strategyContext ? JSON.stringify(params.context.strategyContext) : null,
            agentType: params.context?.strategyContext?.agentType || 'SCALPER',
          })
          .catch((err) => console.error('❌ Failed to save paper trade to DB:', err))
      }

      console.log(`📝 [PAPER TRADE] ${order.side} ${order.quantity}x ${order.symbol} @ ${order.price}`)

      // Safety check: If AI provides an invalid SL (higher than entry for a BUY),
      // we should invalidate that SL to prevent an immediate exit loop.
      // NOTE: We must first check if the SL is an INDEX level (> 1000) and translate it to PREMIUM.
      const pos = this.positions.get(order.symbol)
      if (pos && pos.side === 'BUY') {
        // 1. Detect and translate index-level SL
        if (pos.aiStopLoss !== undefined && pos.aiStopLoss > 1000) {
          const fallbackOffset = pos.side === 'BUY' ? 50 : -50
          const indexPrice = params.context?.strategyContext?.indexSl || pos.aiStopLoss + fallbackOffset
          const indexRisk = Math.abs(indexPrice - pos.aiStopLoss)
          const agentType = params.context?.strategyContext?.agentType || 'SCALPER'

          const dynamicDelta = params.context?.optionDelta
            ? Math.abs(params.context.optionDelta)
            : pos.optionDelta
              ? Math.abs(pos.optionDelta)
              : agentType === 'TREND'
                ? 0.45
                : 0.6
          const effectiveDelta = agentType === 'TREND' ? Math.max(0.1, dynamicDelta * 0.9) : Math.max(0.1, dynamicDelta)
          const premiumRisk = indexRisk * effectiveDelta

          const oldSl = pos.aiStopLoss
          pos.aiStopLoss = Math.max(order.price! - premiumRisk, 0.05)
          console.log(
            `[PAPER TRADE] Translated Index SL ${oldSl} to Premium SL ${pos.aiStopLoss.toFixed(2)} (Risk: ${premiumRisk.toFixed(2)})`
          )
        }

        // 2. Detect and translate index-level Target
        if (pos.aiTarget !== undefined && pos.aiTarget > 1000) {
          const fallbackOffset = pos.side === 'BUY' ? -100 : 100
          const indexPrice = params.context?.strategyContext?.indexSl || pos.aiTarget + fallbackOffset
          const indexGain = Math.abs(pos.aiTarget - indexPrice)
          const agentType = params.context?.strategyContext?.agentType || 'SCALPER'

          const dynamicDelta = params.context?.optionDelta
            ? Math.abs(params.context.optionDelta)
            : pos.optionDelta
              ? Math.abs(pos.optionDelta)
              : agentType === 'TREND'
                ? 0.45
                : 0.6
          const effectiveDelta = agentType === 'TREND' ? Math.max(0.1, dynamicDelta * 0.9) : Math.max(0.1, dynamicDelta)
          const premiumGain = indexGain * effectiveDelta

          const oldTarget = pos.aiTarget
          pos.aiTarget = order.price! + premiumGain
          console.log(
            `[PAPER TRADE] Translated Index Target ${oldTarget} to Premium Target ${pos.aiTarget.toFixed(2)} (Gain: ${premiumGain.toFixed(2)})`
          )
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
      let title = order.side === 'BUY' ? '🚀 Trade Executed' : '✅ Position Closed'
      let type = order.side === 'BUY' ? 'success' : 'info'

      if (order.side === 'SELL') {
        const existing = this.positions.get(order.symbol)
        if (existing) {
          if (existing.aiStopLoss && order.price! <= existing.aiStopLoss) {
            title = '🛑 Stop-Loss Hit'
            type = 'error'
          } else if (existing.aiTarget && order.price! >= existing.aiTarget) {
            title = '🎯 Target Reached'
            type = 'success'
          }
        }
      }

      this.emit('notification', {
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

      this.emit('order_update', order)
      this.emit('portfolio_update', this.getAllPositions())

      if (params.side === 'SELL') {
        this.exitingPositions.delete(params.symbol)
      }

      return { success: true, orderId }
    } finally {
      this.inFlightOrders.delete(lockKey)
    }
  }

  private async updatePosition(order: TradeOrder, context?: TradeContext) {
    const existing = this.positions.get(order.symbol)

    if (order.side === 'BUY') {
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
          side: 'BUY',
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
        if (context?.optionExpiry) pos.optionExpiry = context.optionExpiry
        if (context?.optionDelta) pos.optionDelta = context.optionDelta

        // ── Tiered Profit Ladder ──────────────────────────────────────────────
        const daysToExpiry = pos.optionExpiry
          ? Math.max(0, (new Date(pos.optionExpiry).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
          : 2

        if (context) {
          const tierTargetInput = {
            entryPrice: pos.avgEntryPrice,
            aiStopLoss: pos.aiStopLoss!,
            optionDelta: pos.optionDelta || context.optionDelta || 0.01,
            daysToExpiry,
            quantity: order.quantity || 65,
            lotSize: context.lotSize || 1,
            ...(context.aiIndexTargets?.length ? { aiIndexTargets: context.aiIndexTargets } : {}),
            ...(context.currentIndexPrice ? { currentIndexPrice: context.currentIndexPrice } : {}),
          }
          const tiers = computeTieredTargets(tierTargetInput)

          if (tiers) {
            pos.t1Target = tiers.t1Target
            pos.t2Target = tiers.t2Target
            pos.t3Target = tiers.t3Target
            pos.t1Qty = tiers.t1Qty
            pos.t2Qty = tiers.t2Qty
            pos.t1Hit = false
            pos.t2Hit = false
          }
        }
        // ─────────────────────────────────────────────────────────────────────

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
        const openTrades = await tradeRepo.getOpenTrades(this.userId)
        const targetTrade = openTrades
          .filter((t) => t.symbol === order.symbol)
          .sort((a, b) => new Date(b.openedAt).getTime() - new Date(a.openedAt).getTime())[0]
        if (targetTrade) {
          await tradeRepo
            .closeTrade(targetTrade.id, order.price!, context?.aiReasoning, context?.strategyContext?.agentType)
            .catch((err) => console.error('❌ Failed to close trade in DB:', err))
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

    for (const [symbol, pos] of this.positions.entries()) {
      if (pos.token === token) {
        pos.currentPrice = price
        pos.unrealizedPnL = (price - pos.avgEntryPrice) * pos.quantity
        changed = true

        // Tick-Level Hard Exit Monitoring (runs on every price tick — fastest possible protection)
        if (pos.side === 'BUY' && !this.exitingPositions.has(symbol)) {
          // ── Hard Stop-Loss (always runs first, highest priority) ───────────
          if (pos.aiStopLoss && price <= pos.aiStopLoss) {
            console.log(`[EXIT] ⛔ Stop-Loss hit for ${symbol} @ ${price} (SL: ${pos.aiStopLoss})`)
            this.emit('notification', {
              title: `⛔ Stop-Loss Hit`,
              message: `${symbol} exited @ ₹${price.toFixed(2)} (SL: ₹${pos.aiStopLoss.toFixed(2)})`,
              type: 'error',
            })
            await this.placeOrder({
              symbol: pos.symbol,
              token: pos.token,
              side: 'SELL',
              quantity: pos.quantity,
              price: price,
              context: { aiReasoning: 'Stop-Loss hit' },
            })

            // ── Tiered Profit Ladder ──────────────────────────────────────────
          } else if (pos.t1Target && !pos.t1Hit && price >= pos.t1Target) {
            // T1 Hit
            pos.t1Hit = true
            const prevSl = pos.aiStopLoss?.toFixed(2) ?? '—'
            pos.aiStopLoss = pos.avgEntryPrice // move SL to breakeven

            if (pos.t1Qty && pos.t1Qty > 0) {
              // Partial exit — sell T1 qty
              console.log(`[EXIT] 🥇 T1 hit for ${symbol} @ ₹${price} — selling ${pos.t1Qty}qty, SL→breakeven`)
              this.emit('notification', {
                title: `🥇 T1 Hit — Partial Booked`,
                message: `${symbol}: Sold ${pos.t1Qty}qty @ ₹${price.toFixed(2)}. SL moved to breakeven (was ₹${prevSl})`,
                type: 'success',
              })
              await this.placeOrder({
                symbol: pos.symbol,
                token: pos.token,
                side: 'SELL',
                quantity: pos.t1Qty,
                price: price,
                context: { aiReasoning: `T1 target hit @ ₹${pos.t1Target}` },
              })
            } else {
              // 1-lot: no sell, just breakeven SL
              console.log(`[T1] 🥇 T1 hit for ${symbol} @ ₹${price} — SL moved to breakeven (1-lot: no partial exit)`)
              this.emit('notification', {
                title: `🥇 T1 — Breakeven Stop Set`,
                message: `${symbol} @ ₹${price.toFixed(2)} crossed T1. SL moved to ₹${pos.avgEntryPrice.toFixed(2)} (breakeven). Trade is now risk-free.`,
                type: 'info',
              })
              this.emit('pnl_update', this.getAllPositions())
            }
          } else if (pos.t2Target && pos.t1Hit && !pos.t2Hit && price >= pos.t2Target) {
            // T2 Hit
            pos.t2Hit = true
            const prevSl = pos.aiStopLoss?.toFixed(2) ?? '—'
            if (pos.t1Target) pos.aiStopLoss = pos.t1Target // lock T1 gain

            if (pos.t2Qty && pos.t2Qty > 0) {
              // Partial exit
              console.log(`[EXIT] 🥈 T2 hit for ${symbol} @ ₹${price} — selling ${pos.t2Qty}qty, SL→T1`)
              this.emit('notification', {
                title: `🥈 T2 Hit — Profit Locked`,
                message: `${symbol}: Sold ${pos.t2Qty}qty @ ₹${price.toFixed(2)}. SL locked at T1 ₹${pos.t1Target?.toFixed(2)} (was ₹${prevSl})`,
                type: 'success',
              })
              await this.placeOrder({
                symbol: pos.symbol,
                token: pos.token,
                side: 'SELL',
                quantity: pos.t2Qty,
                price: price,
                context: { aiReasoning: `T2 target hit @ ₹${pos.t2Target}` },
              })
            } else {
              // 2-lot at T2 step: update SL only (e.g., runner going for T3)
              console.log(`[T2] 🥈 T2 hit for ${symbol} @ ₹${price} — SL locked at T1 level`)
              this.emit('notification', {
                title: `🥈 T2 — Profit Locked at T1`,
                message: `${symbol} @ ₹${price.toFixed(2)}. SL locked at ₹${pos.t1Target?.toFixed(2)}. Runner heading for T3.`,
                type: 'info',
              })
              this.emit('pnl_update', this.getAllPositions())
            }
          } else if (pos.t3Target && pos.t2Hit && price >= pos.t3Target) {
            // T3 Hit — full exit of remaining quantity
            console.log(`[EXIT] 🏆 T3 hit for ${symbol} @ ₹${price} — exiting remaining ${pos.quantity}qty`)
            this.emit('notification', {
              title: `🏆 Full Target Booked!`,
              message: `${symbol}: Remaining ${pos.quantity}qty exited @ ₹${price.toFixed(2)} (T3: ₹${pos.t3Target.toFixed(2)})`,
              type: 'success',
            })
            await this.placeOrder({
              symbol: pos.symbol,
              token: pos.token,
              side: 'SELL',
              quantity: pos.quantity,
              price: price,
              context: { aiReasoning: `T3 hard exit @ ₹${pos.t3Target}` },
            })
          } else if (!pos.t1Target && pos.aiTarget && price >= pos.aiTarget) {
            // Fallback: no tier system computed — use single hard aiTarget
            console.log(`[EXIT] 🎯 Target reached for ${symbol} @ ${price} (Target: ${pos.aiTarget})`)
            this.emit('notification', {
              title: `🎯 Target Booked!`,
              message: `${symbol} exited @ ₹${price.toFixed(2)} (Target: ₹${pos.aiTarget.toFixed(2)})`,
              type: 'success',
            })
            await this.placeOrder({
              symbol: pos.symbol,
              token: pos.token,
              side: 'SELL',
              quantity: pos.quantity,
              price: price,
              context: { aiReasoning: 'Target reached' },
            })
          }
        }
      }
      currentUnrealized += pos.unrealizedPnL
    }

    if (changed) {
      this.emit('pnl_update', this.getAllPositions())
    }
  }

  getAllPositions(): PaperPosition[] {
    return Array.from(this.positions.values())
  }

  getOrders(): TradeOrder[] {
    return this.orders
  }
}

// Re-export for CLI watch mode
export const paperTrader = new PaperTrader('cli-user', null as any)
