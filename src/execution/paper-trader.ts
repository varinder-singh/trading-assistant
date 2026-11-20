import { EventEmitter } from 'node:events'
import type {
  TradeOrder,
  PaperPosition,
  TradeResponse,
  OrderSide,
  PendingTriggerOrder,
  StrategyContext,
  TradeContext,
} from './types.js'
export type { StrategyContext, TradeContext, PendingTriggerOrder }
import { tradeRepo as defaultTradeRepo } from '../db/repositories/container.js'
import { evaluatePosition } from '../analysis/trade.js'
import type { AIMacroTrend, TradingAgentType } from '../ai/types.js'
import { eventHub } from '../utils/event-hub.js'
import { forEachSequentially } from '../utils/sequential.js'
import { candleBuilder as defaultCandleBuilder } from '../data/candle-builder.js'
import { getMultiTimeframeCandles } from '../data/yahoo.js'
import { getInstrumentToken } from '../data/kite.js'
import type { Connect as KiteConnect } from 'kiteconnect'
import { KiteOrderService } from './kite-orders.js'
import { getGreeksFromPrice } from '../analysis/greeks.js'
import { computeTieredTargets, computeEquityTieredTargets } from './tier-calculator.js'
import { isClosingBellFilterActive, isMarketOpen } from '../utils/market-hours.js'
import {
  getCalendarDaysToExpiry,
  getExpiryRiskProfile,
  getOptionType,
  getPremiumStopFloor,
  getRatchetedStopLoss,
  getShortRatchetedStopLoss,
  isIndexInvalidated,
  isRetractGuardTriggered,
  resolveIndexInvalidation,
  EQUITY_PROFIT_RATCHET_TIERS,
  PEAK_PROFIT_RATCHET_TIERS,
  STOCK_OPTION_PROFIT_RATCHET_TIERS,
  type ExpiryRiskProfile,
} from './expiry-risk-profile.js'

import { createLogger } from '../utils/logger.js'

const logger = createLogger('PaperTrader')
export class PaperTrader extends EventEmitter {
  private positions: Map<string, PaperPosition> = new Map()
  private orders: TradeOrder[] = []
  private pendingTriggerOrders: Map<string, PendingTriggerOrder> = new Map()
  private initialized = false
  private initializationPromise: Promise<void> | null = null
  private exitingPositions: Set<string> = new Set()
  private recentExits: Map<string, Date> = new Map()
  public maxConcurrentPositions = Number(process.env.MAX_ACTIVE_POSITIONS || process.env.MAX_PAPER_POSITIONS || 10)
  public maxIndexPositions = Number(process.env.MAX_INDEX_POSITIONS || 2)
  public entryCooldownMins = Number(process.env.ENTRY_COOLDOWN_MINS || 15)
  private inFlightOrders: Set<string> = new Set()

  private marketMonitorTimer?: NodeJS.Timeout
  private positionManagerTimer?: NodeJS.Timeout

  public maxDailyTrades = Number(process.env.MAX_DAILY_TRADES || 30)
  private maxDailyLoss = Number(process.env.MAX_DAILY_LOSS || -20000)
  private todayRealizedPnL = 0
  private todayTradeCount = 0
  private tradingHalted = false

  // Burst Velocity Governor: Rolling 30-minute position entries limiter
  private recentEntryTimestamps: number[] = []
  public maxEntriesPer30mWindow: number = Number(process.env.MAX_ENTRIES_PER_30M || 5)
  private readonly rollingVelocityWindowMs: number = 30 * 60 * 1000 // 30 minutes

  private kiteOrderService: KiteOrderService | null = null
  public tradeMode: 'PAPER' | 'REAL' = 'PAPER'

  constructor(
    private readonly userId: string,
    private kc: KiteConnect,
    private readonly repo = defaultTradeRepo,
    private readonly builder = defaultCandleBuilder
  ) {
    super()
    this.kiteOrderService = kc ? new KiteOrderService(kc) : null
  }

  /**
   * Dynamically updates the user's position & trade pool allocation from their Profile settings.
   * Ensures NIFTY index slots and stock slots stay balanced according to user preferences.
   */
  public configurePool(config: {
    maxActivePositions?: number | null | undefined
    maxIndexPositions?: number | null | undefined
    maxDailyTrades?: number | null | undefined
    maxEntriesPer30mWindow?: number | null | undefined
  }): void {
    if (config.maxActivePositions && config.maxActivePositions > 0) {
      this.maxConcurrentPositions = Number(config.maxActivePositions)
    }
    if (config.maxIndexPositions !== undefined && config.maxIndexPositions !== null && config.maxIndexPositions >= 0) {
      this.maxIndexPositions = Number(config.maxIndexPositions)
    }
    if (config.maxDailyTrades && config.maxDailyTrades > 0) {
      this.maxDailyTrades = Number(config.maxDailyTrades)
    }
    if (config.maxEntriesPer30mWindow && config.maxEntriesPer30mWindow > 0) {
      this.maxEntriesPer30mWindow = Number(config.maxEntriesPer30mWindow)
    }
  }

  public clearVelocityTracker(): void {
    this.recentEntryTimestamps = []
  }

  public setKiteClient(kc: KiteConnect) {
    this.kc = kc
    this.kiteOrderService = kc ? new KiteOrderService(kc) : null
  }

  public setTradeMode(mode: 'PAPER' | 'REAL') {
    this.tradeMode = mode
    logger.info(`[PaperTrader ${this.userId}] Trade mode set to ${mode}`)
  }

  async initialize() {
    if (this.initialized) return
    if (this.initializationPromise) return this.initializationPromise

    this.initializationPromise = (async () => {
      try {
        const [openTrades, todayTrades] = await Promise.all([
          this.repo.getOpenTrades(this.userId),
          this.repo.getTodaysTrades(this.userId),
        ])

        logger.info(
          `[PaperTrader ${this.userId}] Restoring ${openTrades.length} open trades and analyzing ${todayTrades.length} trades for today...`
        )

        this.todayTradeCount = todayTrades.length
        this.todayRealizedPnL = todayTrades.reduce((acc, t) => acc + (Number(t.pnl) || 0), 0)
        logger.info(`[PaperTrader] Today PnL from trades ${this.todayRealizedPnL}`)

        openTrades.forEach((trade) => this.restoreTradePosition(trade))

        if (this.todayTradeCount >= this.maxDailyTrades || this.todayRealizedPnL <= this.maxDailyLoss) {
          logger.info(
            `[PaperTrader] Trading halted on initialization. Trades: ${this.todayTradeCount}, PnL: ${this.todayRealizedPnL}`
          )
          this.tradingHalted = true
        }

        this.initialized = true
        logger.info('[PaperTrader] Initialization complete.')

        this.emit(
          'initialized',
          Array.from(this.positions.values())
            .map((p) => p.token)
            .filter((t) => !!t)
        )

        this.startMarketMonitor()
        this.startPositionManager()
      } catch (err) {
        logger.error('[PaperTrader] Failed to initialize:', err)
        throw err
      } finally {
        this.initializationPromise = null
      }
    })()

    return this.initializationPromise
  }

  private restoreTradePosition(trade: any): void {
    const existing = this.positions.get(trade.symbol)
    if (existing) {
      const totalQty = existing.quantity + trade.quantity
      const totalCost = Number(existing.avgEntryPrice) * existing.quantity + Number(trade.entryPrice) * trade.quantity
      existing.avgEntryPrice = totalCost / totalQty
      existing.quantity = totalQty
      if ((!existing.token || existing.token === 0) && trade.instrumentToken) existing.token = trade.instrumentToken
      return
    }

    const pos: PaperPosition = {
      symbol: trade.symbol,
      token: trade.instrumentToken || 0,
      side: trade.side || 'BUY',
      quantity: trade.quantity,
      avgEntryPrice: Number(trade.entryPrice),
      currentPrice: Number(trade.entryPrice),
      peakPrice: Number(trade.entryPrice),
      unrealizedPnL: 0,
      maxUnrealizedPnL: 0,
      realizedPnL: 0,
      product: trade.product || 'MIS',
      assetClass: trade.assetClass || 'INDEX_OPTION',
      timestamp: new Date(trade.openedAt),
    }
    if (trade.strikePrice) pos.strike = Number(trade.strikePrice)
    if (trade.entryMetadata?.aiStopLoss) pos.aiStopLoss = Number(trade.entryMetadata.aiStopLoss)
    if (trade.entryMetadata?.aiTarget) pos.aiTarget = Number(trade.entryMetadata.aiTarget)
    if (pos.aiStopLoss && pos.aiTarget) {
      this.applyTieredTargets(pos, trade.quantity, {
        aiStopLoss: pos.aiStopLoss,
        aiTarget: pos.aiTarget,
        aiIndexTargets: trade.entryMetadata?.aiIndexTargets,
      })
    }
    this.positions.set(trade.symbol, pos)
  }

  private startMarketMonitor() {
    if (this.marketMonitorTimer) clearInterval(this.marketMonitorTimer)
    this.marketMonitorTimer = setInterval(() => {
      this.checkMarketStatus()
    }, 60 * 1000)
  }

  private startPositionManager() {
    const intervalMins = Number(process.env.POSITION_EVAL_INTERVAL_MINS || 1)
    logger.info(`[Risk Manager] Starting periodic position re-evaluation every ${intervalMins} minutes...`)

    if (this.positionManagerTimer) clearInterval(this.positionManagerTimer)
    this.positionManagerTimer = setInterval(
      async () => {
        if (!isMarketOpen()) {
          logger.info('[Risk Manager] Market is closed. Suspending position re-evaluation.')
          return
        }
        await this.runPositionManagerCycle()
      },
      intervalMins * 60 * 1000
    )
  }

  private async runPositionManagerCycle(): Promise<void> {
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

    logger.info(`\n[Risk Manager] Re-evaluating ${positions.length} active positions...`)

    await forEachSequentially(positions, (pos) => this.evaluateSinglePosition(pos))

    this.logGreeksDashboard(positions)

    eventHub.emit('agent_update', {
      agent: 'Risk Manager',
      status: 'decided',
      message: `Positions managed. Holding ${positions.length} active position(s).`,
      data: {
        rationale: `Risk evaluation completed for ${positions.length} positions. Checked trailing stops, targets, and live Greeks (Delta, Theta, Vega) based on recent market action.`,
        reason: `Evaluated ${positions.length} positions to ensure no predefined risk limits were breached.`,
      },
    })
  }

  private async evaluateSinglePosition(pos: PaperPosition): Promise<void> {
    try {
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
        await this.builder.seedFromKite(this.kc, underlyingToken)
      }

      const { decision, marketData, agentType } = await evaluatePosition(
        this.kc,
        symbol,
        pos,
        {
          candles1d: macro.candles1d,
          candles1h: macro.candles1h,
          candles30m: this.builder.getCandles(underlyingToken || 0, 30),
          candles15m: this.builder.getCandles(underlyingToken || 0, 15),
          candles5m: this.builder.getCandles(underlyingToken || 0, 5),
        },
        this.userId
      )

      this.updatePositionGreeks(pos, marketData.tf15m.price)

      this.syncAgentType(pos, agentType)

      if (decision.decision === 'EXIT') {
        const exitSide: OrderSide = pos.side === 'SELL' ? 'BUY' : 'SELL'
        logger.info(
          `[Risk Manager] AI (${agentType} Agent) signaled EXIT for ${pos.symbol}. Reason: ${decision.reason}`
        )
        await this.placeOrder({
          symbol: pos.symbol,
          token: pos.token,
          side: exitSide,
          quantity: pos.quantity,
          price: pos.currentPrice,
          context: { aiReasoning: decision.reason },
        })
      } else if (decision.decision === 'UPDATE_SL' && decision.newIndexStopLoss) {
        this.applyTrailingStopUpdate(pos, decision, marketData.tf15m.price, agentType)
      }
    } catch (err) {
      logger.error(`[Risk Manager] Failed to re-evaluate position ${pos.symbol}:`, err)
    }
  }

  private syncAgentType(pos: PaperPosition, agentType: TradingAgentType): void {
    if (pos.strategyContext?.agentType === agentType) return

    logger.info(`[Risk Manager] Agent for ${pos.symbol} updated to ${agentType}`)
    // Legacy positions may carry no strategy context yet; only agentType is guaranteed here.
    pos.strategyContext = { ...(pos.strategyContext ?? ({} as StrategyContext)), agentType }
  }

  private resolveExpiryCloseTimeMs(expiry: string | Date): number {
    const expiryDate = new Date(expiry)
    if (Number.isNaN(expiryDate.getTime())) return Date.now()
    const istDateStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(expiryDate)
    return new Date(`${istDateStr}T15:30:00+05:30`).getTime()
  }

  private updatePositionGreeks(pos: PaperPosition, spotPrice: number): void {
    if (!pos.optionExpiry || !pos.strike || (!pos.symbol.endsWith('CE') && !pos.symbol.endsWith('PE'))) return

    const expiryTime = this.resolveExpiryCloseTimeMs(pos.optionExpiry)
    const daysToExpiry = Math.max(0.001, (expiryTime - Date.now()) / (1000 * 60 * 60 * 24))
    const type = pos.symbol.endsWith('CE') ? 'CE' : 'PE'

    const greeks = getGreeksFromPrice(pos.currentPrice, spotPrice, pos.strike, daysToExpiry, 0.07, type)

    if (greeks) {
      pos.optionDelta = greeks.delta
      pos.optionTheta = greeks.theta
      pos.optionVega = greeks.vega
    }
  }

  private resolveEffectiveDelta(pos: PaperPosition, agentType: TradingAgentType, contextDelta?: number): number {
    const rawDelta = contextDelta ?? pos.optionDelta
    const dynamicDelta = rawDelta ? Math.abs(rawDelta) : agentType === 'TREND' ? 0.45 : 0.6
    return agentType === 'TREND' ? Math.max(0.1, dynamicDelta * 0.9) : Math.max(0.1, dynamicDelta)
  }

  private calculateTrailingStopLevels(
    pos: PaperPosition,
    newIndexStopLoss: number,
    spotPrice: number,
    agentType: TradingAgentType
  ): { rawPremiumSl: number; optionRiskPoints: number; isIndexScale: boolean } {
    const isIndexScale = spotPrice > 0 && newIndexStopLoss > spotPrice * 0.7 && newIndexStopLoss < spotPrice * 1.3
    if (!isIndexScale) {
      logger.warn(
        `[Risk Manager] AI returned a premium SL instead of an Index SL: ${newIndexStopLoss}. Using it directly.`
      )
      return {
        rawPremiumSl: newIndexStopLoss,
        optionRiskPoints: Math.abs(pos.currentPrice - newIndexStopLoss),
        isIndexScale: false,
      }
    }

    const optionType = getOptionType(pos.symbol)
    const isProtectiveIndexSl =
      !optionType || (optionType === 'CE' ? newIndexStopLoss < spotPrice : newIndexStopLoss > spotPrice)
    const indexRiskPoints = isProtectiveIndexSl ? Math.abs(spotPrice - newIndexStopLoss) : spotPrice * 0.003
    const effectiveDelta = this.resolveEffectiveDelta(pos, agentType)
    const optionRiskPoints = indexRiskPoints * effectiveDelta
    const rawPremiumSl = Math.max(pos.aiStopLoss ?? 0, pos.currentPrice - optionRiskPoints)
    return { rawPremiumSl, optionRiskPoints, isIndexScale: isProtectiveIndexSl }
  }

  private calculateTrailingTarget(
    pos: PaperPosition,
    optionRiskPoints: number,
    riskRewardRatio: number | undefined,
    agentType: TradingAgentType
  ): number {
    const multiplier = agentType === 'TREND' ? (riskRewardRatio ? riskRewardRatio * 1.5 : 4.0) : riskRewardRatio || 2.0
    const candidateTarget = pos.currentPrice + optionRiskPoints * multiplier
    return pos.aiTarget && candidateTarget < pos.aiTarget ? pos.aiTarget : candidateTarget
  }

  private capStopLossAtSafetyFloor(pos: PaperPosition, rawPremiumSl: number, agentType: TradingAgentType): number {
    const profile = this.getRiskProfile(pos)
    const maxRiskPct = agentType === 'SCALPER' ? Math.min(0.2, profile.maxPremiumRiskPct) : profile.maxPremiumRiskPct
    const minAllowedSl = pos.avgEntryPrice * (1 - maxRiskPct)

    if (rawPremiumSl >= minAllowedSl) return rawPremiumSl

    logger.warn(
      `[Risk Manager] Capping SL for ${pos.symbol} at ${agentType} (${profile.bucket}) safety floor: ${minAllowedSl.toFixed(2)}`
    )
    return minAllowedSl
  }

  private applyTrailingStopUpdate(
    pos: PaperPosition,
    decision: { newIndexStopLoss: number; riskRewardRatio?: number | undefined },
    spotPrice: number,
    agentType: TradingAgentType
  ): void {
    const { rawPremiumSl, optionRiskPoints, isIndexScale } = this.calculateTrailingStopLevels(
      pos,
      decision.newIndexStopLoss,
      spotPrice,
      agentType
    )
    const flooredSl = this.capStopLossAtSafetyFloor(pos, rawPremiumSl, agentType)
    const newPremiumSl = Math.min(flooredSl, pos.currentPrice * 0.98)
    pos.aiTarget = this.calculateTrailingTarget(pos, optionRiskPoints, decision.riskRewardRatio, agentType)

    if (isIndexScale) {
      const optionType = getOptionType(pos.symbol)
      const isTighterIndexStop =
        pos.indexInvalidation === undefined ||
        (optionType === 'CE'
          ? decision.newIndexStopLoss > pos.indexInvalidation
          : decision.newIndexStopLoss < pos.indexInvalidation)
      if (isTighterIndexStop) {
        pos.indexInvalidation = decision.newIndexStopLoss
      }
    }

    if (pos.aiStopLoss !== undefined && newPremiumSl <= pos.aiStopLoss) {
      logger.info(
        `[Risk Manager] Ignoring calculated SL (${newPremiumSl.toFixed(2)}) as it is lower than or equal to current SL (${pos.aiStopLoss.toFixed(2)}) for ${pos.symbol}.`
      )
      return
    }

    logger.info(
      `[Risk Manager] AI (${agentType} Agent) signaled UPDATE_SL for ${pos.symbol}. Index SL: ${decision.newIndexStopLoss} -> Premium SL: ${newPremiumSl.toFixed(2)}`
    )
    pos.aiStopLoss = newPremiumSl
    this.emit('notification', {
      title: `🛡️ Trailing SL (${agentType})`,
      message: `${pos.symbol}: SL moved to ${newPremiumSl.toFixed(2)}`,
      type: 'info',
    })
  }

  private logGreeksDashboard(positions: PaperPosition[]): void {
    logger.info('-------------------------------------------------------------------------------------------------')
    logger.info('📈 LIVE GREEKS DASHBOARD')
    console.table(
      positions.map((p) => ({
        Symbol: p.symbol,
        Qty: p.quantity,
        LTP: p.currentPrice.toFixed(2),
        Peak: p.peakPrice ? p.peakPrice.toFixed(2) : p.currentPrice.toFixed(2),
        PnL: p.unrealizedPnL >= 0 ? `+${p.unrealizedPnL.toFixed(2)}` : p.unrealizedPnL.toFixed(2),
        'Max PnL': p.maxUnrealizedPnL !== undefined ? `+${p.maxUnrealizedPnL.toFixed(2)}` : 'N/A',
        Delta: p.optionDelta ? (p.optionDelta * p.quantity).toFixed(2) : 'N/A',
        Theta: p.optionTheta ? (p.optionTheta * p.quantity).toFixed(2) : 'N/A',
        Vega: p.optionVega ? (p.optionVega * p.quantity).toFixed(2) : 'N/A',
        'Burn/Day': p.optionTheta ? `₹${Math.abs(p.optionTheta * p.quantity).toFixed(2)}` : 'N/A',
      }))
    )
    logger.info('-------------------------------------------------------------------------------------------------\n')
  }

  private checkMarketStatus() {
    const istTime = new Date().toLocaleTimeString('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour12: false,
    })
    const [hoursStr, minutesStr] = istTime.split(':')
    const hours = Number(hoursStr) || 0
    const minutes = Number(minutesStr) || 0

    this.checkIntradaySquareOff(hours, minutes)
    this.checkMarketClose(hours, minutes)
  }

  private checkIntradaySquareOff(hours: number, minutes: number): void {
    const timeInMinutes = hours * 60 + minutes
    if (timeInMinutes < 15 * 60 + 15) return

    const misPositions = this.getAllPositions().filter((p) => !p.product || p.product === 'MIS')
    if (misPositions.length === 0) return

    logger.info(`[EXIT] 15:15 IST - Closing ${misPositions.length} Intraday (MIS) positions before broker cutoff.`)
    this.squareOffPositions(misPositions, 'Intraday EOD Square-Off (3:15 PM Rule)')
  }

  private checkMarketClose(hours: number, minutes: number): void {
    const timeInMinutes = hours * 60 + minutes
    if (timeInMinutes < 15 * 60 + 30) return

    const misPositions = this.getAllPositions().filter((p) => !p.product || p.product === 'MIS')
    if (misPositions.length > 0) {
      logger.info(`[EXIT] 15:30 IST - Market Closed. Squaring off remaining ${misPositions.length} open MIS position(s).`)
      this.squareOffPositions(misPositions, 'Market Close Square-Off (15:30 Rule)')
    }

    logger.info('[EXIT] 15:30 IST - Market Closed. Emitting shutdown signal.')
    this.emit('market_close')
  }

  async squareOffPositions(positions: PaperPosition[], reason: string = 'Market Square-off') {
    await forEachSequentially(positions, async (pos) => {
      // Re-checked per position: an earlier exit in this loop may change what is already exiting.
      if (this.exitingPositions.has(pos.symbol)) return

      const exitSide: OrderSide = pos.side === 'SELL' ? 'BUY' : 'SELL'
      await this.placeOrder({
        symbol: pos.symbol,
        token: pos.token,
        side: exitSide,
        quantity: pos.quantity,
        price: pos.currentPrice,
        context: { aiReasoning: reason, product: pos.product, assetClass: pos.assetClass },
      })
    })
  }

  async squareOffAll(reason: string = 'Market Square-off') {
    await this.squareOffPositions(this.getAllPositions(), reason)
  }

  /**
   * Determines whether an incoming order is opening a new position (either Long BUY or Intraday Short SELL)
   * versus closing/reducing an existing open position.
   */
  private isOpeningOrder(params: { symbol: string; side: OrderSide; context?: TradeContext | undefined }): boolean {
    const existing = this.positions.get(params.symbol)
    if (params.side === 'BUY') {
      return existing?.side !== 'SELL'
    }
    return Boolean(params.context?.isShortEntry) && existing?.side !== 'BUY'
  }

  async placeOrder(params: {
    symbol: string
    token: number
    strike?: number | undefined
    side: OrderSide
    quantity: number
    price: number
    context?: TradeContext | undefined
  }): Promise<TradeResponse> {
    await this.initialize()

    const lockKey = `${params.side}_${params.symbol}_${params.strike || 'ANY'}`
    if (this.inFlightOrders.has(lockKey)) {
      logger.info(`❌ [PAPER TRADE] Order already in-flight for ${lockKey}. Rejecting duplicate.`)
      return { success: false, error: 'Order already in progress' }
    }
    this.inFlightOrders.add(lockKey)

    const isOpening = this.isOpeningOrder(params)

    try {
      if (isOpening) {
        const validation = this.validateBuyOrder(params)
        if (!validation.valid) return { success: false, error: validation.error }
        params.quantity = this.calculateBuyQuantity(params)
        this.todayTradeCount++
        this.recentEntryTimestamps.push(Date.now())
      } else {
        if (this.exitingPositions.has(params.symbol)) {
          logger.info(`⚠️ [PAPER TRADE] Exit already in progress for ${params.symbol}. Skipping duplicate exit.`)
          return { success: false, error: 'Exit already in progress' }
        }
        this.exitingPositions.add(params.symbol)
        const strike = params.strike || this.positions.get(params.symbol)?.strike
        const cooldownKey = strike ? `${params.symbol}_${strike}` : params.symbol
        this.recentExits.set(cooldownKey, new Date())
      }

      if (this.tradeMode === 'REAL' && this.kiteOrderService) {
        logger.info(`⚡ [LIVE TRADE] Placing real order for ${params.quantity}x ${params.symbol} (${params.side})`)
        const liveOrder = await this.kiteOrderService.placeOrder({
          symbol: params.symbol,
          side: params.side,
          quantity: params.quantity,
          type: 'MARKET',
          price: params.price,
        })

        if (!liveOrder.success) {
          logger.error(`❌ [LIVE TRADE] Failed to place order: ${liveOrder.error}`)
          if (!isOpening) this.exitingPositions.delete(params.symbol)
          return { success: false, error: liveOrder.error }
        }
        logger.info(`✅ [LIVE TRADE] Order Placed! ID: ${liveOrder.orderId}`)
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

      this.orders = [...this.orders, order]
      await this.updatePosition(order, params.context)

      this.emitOrderEvents(order, { ...params, isOpening })

      return { success: true, orderId }
    } finally {
      this.inFlightOrders.delete(lockKey)
    }
  }

  async queuePendingOrder(order: PendingTriggerOrder): Promise<void> {
    await this.initialize()

    if (this.todayRealizedPnL <= this.maxDailyLoss) this.tradingHalted = true
    if (this.tradingHalted) {
      logger.warn(
        `⚠️ [PAPER TRADE] Trading halted for the day (Limits reached). Cannot queue pending order for ${order.symbol}.`
      )
      return
    }

    const existing = Array.from(this.pendingTriggerOrders.values()).find(
      (o) => o.symbol === order.symbol && o.status === 'PENDING'
    )
    if (existing) {
      logger.warn(`⚠️ [PAPER TRADE] Pending order already exists for ${order.symbol}. Rejecting duplicate queue.`)
      return
    }

    this.pendingTriggerOrders.set(order.id, order)

    const pendingRecord: TradeOrder = {
      id: order.id,
      symbol: order.symbol,
      token: order.token,
      side: order.side,
      quantity: order.quantity,
      price: order.triggerPrice,
      type: order.type,
      status: 'PENDING',
      timestamp: order.createdAt,
      ...(order.strike !== undefined ? { strike: order.strike } : {}),
    }
    this.orders = [...this.orders, pendingRecord]

    logger.info(
      `⏳ [PAPER TRADE] Queued Pending Trigger Order ${order.id}: ${order.side} ${order.quantity}x ${order.symbol} @ trigger ₹${order.triggerPrice.toFixed(2)} (TTL: ${Math.round(order.ttlMs / 60000)}m)`
    )

    this.emit('notification', {
      title: '⏳ Pending Trigger Order Queued',
      message: `${order.symbol} Limit BUY @ ₹${order.triggerPrice.toFixed(2)} (TTL: ${Math.round(order.ttlMs / 60000)}m)`,
      type: 'info',
    })
  }

  getPendingOrders(): PendingTriggerOrder[] {
    return Array.from(this.pendingTriggerOrders.values())
  }

  async cancelPendingOrder(orderId: string, reason: string = 'User Cancelled'): Promise<boolean> {
    const order = this.pendingTriggerOrders.get(orderId)
    if (!order || order.status !== 'PENDING') return false

    order.status = 'CANCELLED'
    this.pendingTriggerOrders.delete(orderId)

    const recorded = this.orders.find((o) => o.id === orderId)
    if (recorded) recorded.status = 'CANCELLED'

    logger.info(`[PAPER TRADE] ❌ Cancelled pending trigger order ${orderId} (${reason})`)
    this.emit('notification', {
      title: '❌ Pending Order Cancelled',
      message: `${order.symbol} order cancelled: ${reason}`,
      type: 'info',
    })
    return true
  }

  private validateBuyOrder(params: {
    symbol: string
    strike?: number | undefined
    context?: TradeContext | undefined
  }): {
    valid: boolean
    error?: string | undefined
  } {
    if (isClosingBellFilterActive()) {
      logger.info(`❌ [PAPER TRADE] Intraday entries blocked: Closing bell filter active (after 15:15 IST). Skipping ${params.symbol}`)
      return { valid: false, error: 'Intraday entries blocked: Market approaching close (after 15:15 IST)' }
    }

    if (this.todayRealizedPnL <= this.maxDailyLoss) this.tradingHalted = true
    if (this.tradingHalted) {
      logger.info(`❌ [PAPER TRADE] Trading halted for the day (Limits reached). Skipping ${params.symbol}`)
      return { valid: false, error: 'Trading halted for the day (Limits reached)' }
    }

    if (this.todayTradeCount >= this.maxDailyTrades) {
      logger.info(`❌ [PAPER TRADE] Maximum daily trades reached (${this.maxDailyTrades}). Skipping ${params.symbol}`)
      return { valid: false, error: 'Maximum daily trades reached' }
    }

    if (this.positions.size >= this.maxConcurrentPositions) {
      logger.info(
        `❌ [PAPER TRADE] Limit reached: ${this.positions.size}/${this.maxConcurrentPositions} active positions. Skipping ${params.symbol}`
      )
      return { valid: false, error: 'Maximum concurrent positions reached' }
    }

    if (this.isStockPoolFull(params.context)) {
      const maxStockSlots = this.maxConcurrentPositions - this.maxIndexPositions
      logger.info(
        `❌ [PAPER TRADE] Stock pool limit reached (${maxStockSlots}/${this.maxConcurrentPositions} slots; ${this.maxIndexPositions} reserved for NIFTY Index). Skipping ${params.symbol}`
      )
      return { valid: false, error: 'Maximum stock pool positions reached (slots reserved for Index)' }
    }

    if (this.positions.has(params.symbol)) {
      logger.info(`❌ [PAPER TRADE] Position already exists for ${params.symbol}. Skipping duplicate entry.`)
      return { valid: false, error: 'Position already exists for this symbol' }
    }

    const strike = params.strike || params.context?.aiStrike
    if (strike) {
      const existingStrike = Array.from(this.positions.values()).find((p) => p.strike === strike)
      if (existingStrike) {
        logger.info(
          `❌ [PAPER TRADE] Position already exists for strike ${strike} (${existingStrike.symbol}). Skipping duplicate level entry.`
        )
        return { valid: false, error: `Position already exists for strike ${strike}` }
      }
    }

    const cooldownKey = strike ? `${params.symbol}_${strike}` : params.symbol
    const lastExit = this.recentExits.get(cooldownKey)
    if (lastExit) {
      const diffMins = (Date.now() - lastExit.getTime()) / (60 * 1000)
      const requiredCooldownMins = params.context?.assetClass === 'EQUITY' ? Math.max(this.entryCooldownMins, 45) : this.entryCooldownMins
      if (diffMins < requiredCooldownMins) {
        logger.info(
          `⏳ [PAPER TRADE] Re-entry blocked for ${params.symbol}${strike ? ` (Strike: ${strike})` : ''}. Cooldown: ${diffMins.toFixed(1)}/${requiredCooldownMins} mins.`
        )
        return { valid: false, error: 'Re-entry cooldown active' }
      }
    }

    // RSI Exhaustion Guard:
    // Reject bearish entries (BUY_PE or SELL_EQUITY) if 15m RSI < 35 (exhausted downside, high mean-reversion bounce risk)
    // Reject bullish entries (BUY_CE or BUY_EQUITY) if 15m RSI > 65 (exhausted upside, high pullback risk)
    const rsi = params.context?.rsiLevel
    const setup = params.context?.aiSetup || ''
    const isBearishSetup = params.context?.isShortEntry || setup === 'BUY_PE' || setup === 'SELL_EQUITY' || setup.includes('PE')
    const isBullishSetup = !isBearishSetup && (setup === 'BUY_CE' || setup === 'BUY_EQUITY' || setup.includes('CE'))

    if (rsi !== undefined && rsi !== null && rsi > 0) {
      if (isBearishSetup && rsi < 35) {
        logger.info(`❌ [PAPER TRADE] Entry REJECTED for ${params.symbol}: 15m RSI (${rsi.toFixed(1)}) is oversold (< 35). Exhaustion breakdown risk.`)
        return { valid: false, error: `RSI oversold exhaustion (< 35): ${rsi.toFixed(1)}` }
      }
      if (isBullishSetup && rsi > 65) {
        logger.info(`❌ [PAPER TRADE] Entry REJECTED for ${params.symbol}: 15m RSI (${rsi.toFixed(1)}) is overbought (> 65). Exhaustion breakout risk.`)
        return { valid: false, error: `RSI overbought exhaustion (> 65): ${rsi.toFixed(1)}` }
      }
    }

    // Burst Velocity Governor:
    // Maximum 5 new entries in any rolling 30-minute window to avoid cascading overtrading during sudden market sell-offs
    const now = Date.now()
    this.recentEntryTimestamps = this.recentEntryTimestamps.filter((t) => now - t < this.rollingVelocityWindowMs)
    if (this.recentEntryTimestamps.length >= this.maxEntriesPer30mWindow) {
      logger.info(
        `⏳ [PAPER TRADE] Burst velocity throttle active: ${this.recentEntryTimestamps.length}/${this.maxEntriesPer30mWindow} positions opened in the last 30m. Skipping ${params.symbol} to prevent overtrading cascade.`
      )
      return { valid: false, error: `Burst velocity throttle: max ${this.maxEntriesPer30mWindow} entries per 30 minutes` }
    }

    return { valid: true }
  }

  /**
   * Enforces the user's balanced position pool between NIFTY Index Options and Stocks/Stock Options.
   * Reserves `maxIndexPositions` slots exclusively for Index Options when total pool > maxIndexPositions.
   */
  private isStockPoolFull(context?: TradeContext): boolean {
    const isStockAsset = context?.assetClass === 'EQUITY' || context?.assetClass === 'STOCK_OPTION'
    if (!isStockAsset) return false
    if (this.maxIndexPositions <= 0 || this.maxConcurrentPositions <= this.maxIndexPositions) return false

    const maxStockSlots = this.maxConcurrentPositions - this.maxIndexPositions
    const activeStockCount = this.getAllPositions().filter(
      (p) => p.assetClass === 'EQUITY' || p.assetClass === 'STOCK_OPTION'
    ).length

    return activeStockCount >= maxStockSlots
  }

  private resolveCappedDeltaLots(optionDelta: number | undefined): number {
    const delta = optionDelta ? Math.abs(optionDelta) : 0
    const rawLots =
      process.env.ENABLE_DELTA_LOT_SIZING === 'true' && delta > 0 ? Math.max(1, Math.round(0.5 / delta)) : 1
    if (rawLots <= 4) return rawLots

    logger.warn(`⚠️ [RISK CAP] Delta-Adjusted Sizing: ${rawLots} lots exceeds max cap of 4 lots. Capping to 4.`)
    return 4
  }

  private resolveConfidenceAdjustedLots(cappedLots: number, aiConfidence: number | undefined): number {
    if (aiConfidence === undefined) return cappedLots
    const conf = aiConfidence <= 1.0 ? aiConfidence * 100 : aiConfidence
    if (conf < 60 || conf >= 75 || cappedLots <= 1) return cappedLots

    logger.info(
      `⚖️ [CONFIDENCE TIER] Moderate confidence (${conf.toFixed(0)}%) — reducing from ${cappedLots} lots to 1 lot.`
    )
    return 1
  }

  private calculateEquityQuantity(price?: number, context?: TradeContext): number {
    const riskBudget = Number(process.env.EQUITY_RISK_PER_TRADE || 1500)
    const entry = price || 1
    const sl = context?.aiStopLoss || entry * 0.98
    const slDistance = Math.max(Math.abs(entry - sl), entry * 0.005)
    const qty = Math.max(1, Math.floor(riskBudget / slDistance))
    logger.info(
      `⚖️ [Equity Sizing] Risk Budget: ₹${riskBudget}, SL Distance: ₹${slDistance.toFixed(2)} -> Buying ${qty} shares.`
    )
    return qty
  }

  private calculateOptionQuantity(context?: TradeContext): number {
    const baseLotSize = context?.lotSize || 1
    if (context?.assetClass === 'STOCK_OPTION' && baseLotSize <= 1) {
      logger.warn('⚠️ [PaperTrader] Stock option missing contract lot size! Defaulting to 1.')
    }
    const cappedLots = this.resolveCappedDeltaLots(context?.optionDelta)
    const numLots = this.resolveConfidenceAdjustedLots(cappedLots, context?.aiConfidence)
    const qty = baseLotSize * numLots
    logger.info(
      `⚖️ Sizing: ${numLots > 1 ? `Delta=${Math.abs(context?.optionDelta || 0).toFixed(2)} -> ` : ''}Buying ${numLots} lot(s) (${qty} qty) with lot size ${baseLotSize}.`
    )
    return qty
  }

  private calculateBuyQuantity(params: { price?: number; context?: TradeContext | undefined }): number {
    if (params.context?.assetClass === 'EQUITY') {
      return this.calculateEquityQuantity(params.price, params.context)
    }
    return this.calculateOptionQuantity(params.context)
  }

  private persistBuyTrade(order: TradeOrder, context?: TradeContext): void {
    this.repo
      .insertTrade({
        userId: this.userId,
        symbol: order.symbol,
        token: order.token,
        side: order.side,
        quantity: order.quantity,
        entry_price: order.price!,
        strike_price: order.strike || null,
        product: context?.product || 'MIS',
        assetClass: context?.assetClass || 'INDEX_OPTION',
        ai_reasoning: context?.aiReasoning || null,
        ai_confidence: context?.aiConfidence || null,
        vix_level: context?.vixLevel || null,
        rsi_level: context?.rsiLevel || null,
        trend_15m: context?.trend15m || null,
        ai_stop_loss: context?.aiStopLoss || null,
        ai_target: context?.aiTarget || null,
        setup: context?.aiSetup || null,
        strategy_context: context?.strategyContext ? JSON.stringify(context.strategyContext) : null,
        agentType: context?.strategyContext?.agentType || 'SCALPER',
      })
      .catch((err) => logger.error('❌ Failed to save paper trade to DB:', err))
  }

  private getOrderNotificationMeta(
    order: TradeOrder,
    isEntryOrder: boolean
  ): { title: string; type: 'success' | 'info' | 'error' } {
    if (isEntryOrder) return { title: '🚀 Trade Executed', type: 'success' }

    const existing = this.positions.get(order.symbol)
    if (existing?.aiStopLoss && order.price! <= existing.aiStopLoss) {
      if (order.price! >= existing.avgEntryPrice) {
        return { title: '🔒 Trailing SL Hit (Profit Locked)', type: 'info' }
      }
      return { title: '🛑 Stop-Loss Hit', type: 'error' }
    }
    if (existing?.aiTarget && order.price! >= existing.aiTarget) {
      return { title: '🎯 Target Reached', type: 'success' }
    }
    return { title: '✅ Position Closed', type: 'info' }
  }

  private emitOrderEvents(
    order: TradeOrder,
    params: {
      side?: OrderSide | undefined
      symbol?: string | undefined
      context?: TradeContext | undefined
      isOpening?: boolean | undefined
    }
  ): void {
    const activePos = this.positions.get(order.symbol)
    const isEntryOrder =
      params.isOpening !== undefined
        ? params.isOpening
        : (order.side === 'BUY' && (!activePos || activePos.side === 'BUY')) ||
          (order.side === 'SELL' && Boolean(params.context?.isShortEntry))

    if (isEntryOrder) {
      this.persistBuyTrade(order, params.context)
    }

    logger.info(`📝 [PAPER TRADE] ${order.side} ${order.quantity}x ${order.symbol} @ ${order.price}`)

    this.sanitizeTradeLevels(order, params.context)

    const { title, type } = this.getOrderNotificationMeta(order, isEntryOrder)

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

    if (!isEntryOrder && params.symbol) {
      this.exitingPositions.delete(params.symbol)
    }
  }

  private translateIndexStopToPremium(pos: PaperPosition, orderPrice: number, context?: TradeContext): number {
    const fallbackOffset = pos.symbol.endsWith('PE') ? -50 : 50
    const indexPrice = context?.currentIndexPrice || pos.aiStopLoss! + fallbackOffset
    const indexRisk = Math.abs(indexPrice - pos.aiStopLoss!)
    const agentType = context?.strategyContext?.agentType || 'SCALPER'
    const effectiveDelta = this.resolveEffectiveDelta(pos, agentType, context?.optionDelta)
    return Math.max(orderPrice - indexRisk * effectiveDelta, 0.05)
  }

  private translateIndexTargetToPremium(pos: PaperPosition, orderPrice: number, context?: TradeContext): number {
    const fallbackOffset = pos.symbol.endsWith('PE') ? 100 : -100
    const indexPrice = context?.currentIndexPrice || pos.aiTarget! + fallbackOffset
    const indexGain = Math.abs(pos.aiTarget! - indexPrice)
    const agentType = context?.strategyContext?.agentType || 'SCALPER'
    const effectiveDelta = this.resolveEffectiveDelta(pos, agentType, context?.optionDelta)
    return orderPrice + indexGain * effectiveDelta
  }

  private sanitizeTradeLevels(order: TradeOrder, context?: TradeContext): void {
    const pos = this.positions.get(order.symbol)
    if (!pos) return

    if (pos.assetClass === 'EQUITY') {
      if (pos.side === 'SELL') {
        if (pos.aiStopLoss !== undefined && pos.aiStopLoss <= order.price!) delete pos.aiStopLoss
        if (pos.aiTarget !== undefined && pos.aiTarget >= order.price!) delete pos.aiTarget
        return
      }
      if (pos.aiStopLoss !== undefined && pos.aiStopLoss >= order.price!) {
        delete pos.aiStopLoss
      }
      if (pos.aiTarget !== undefined && pos.aiTarget <= order.price!) {
        delete pos.aiTarget
      }
      return
    }

    if (pos.side !== 'BUY') return

    if (pos.assetClass === 'INDEX_OPTION') {
      if (pos.aiStopLoss !== undefined && pos.aiStopLoss > 1000) {
        pos.aiStopLoss = this.translateIndexStopToPremium(pos, order.price!, context)
      }

      if (pos.aiTarget !== undefined && pos.aiTarget > 1000) {
        pos.aiTarget = this.translateIndexTargetToPremium(pos, order.price!, context)
      }
    }

    if (pos.aiStopLoss !== undefined && pos.aiStopLoss >= order.price!) {
      delete pos.aiStopLoss
    }
    if (pos.aiTarget !== undefined && pos.aiTarget <= order.price!) {
      delete pos.aiTarget
    }
    this.enforcePremiumStopFloor(pos)
  }

  private async updatePosition(order: TradeOrder, context?: TradeContext) {
    const existing = this.positions.get(order.symbol)
    const isOpeningOrAdding =
      (order.side === 'BUY' && (!existing || existing.side === 'BUY')) ||
      (order.side === 'SELL' && Boolean(context?.isShortEntry) && (!existing || existing.side === 'SELL'))

    if (isOpeningOrAdding) {
      this.openOrAddBuyPosition(existing, order, context)
      return
    }
    if (existing) {
      await this.reduceOrClosePosition(existing, order, context)
    }
  }

  private openOrAddBuyPosition(existing: PaperPosition | undefined, order: TradeOrder, context?: TradeContext): void {
    if (existing) {
      const totalQty = existing.quantity + order.quantity
      const totalCost = existing.avgEntryPrice * existing.quantity + order.price! * order.quantity
      existing.avgEntryPrice = totalCost / totalQty
      existing.quantity = totalQty
      if (context?.aiStopLoss) existing.aiStopLoss = context.aiStopLoss
      if (context?.aiTarget) existing.aiTarget = context.aiTarget
      if (order.strike) existing.strike = order.strike
      return
    }

    const pos = this.createBuyPosition(order, context)
    this.positions.set(order.symbol, pos)
  }

  private createBuyPosition(order: TradeOrder, context?: TradeContext): PaperPosition {
    const pos: PaperPosition = {
      symbol: order.symbol,
      token: order.token,
      side: order.side,
      quantity: order.quantity,
      avgEntryPrice: order.price!,
      currentPrice: order.price!,
      peakPrice: order.price!,
      unrealizedPnL: 0,
      maxUnrealizedPnL: 0,
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
    if (context?.product) pos.product = context.product
    if (context?.assetClass) pos.assetClass = context.assetClass
    this.applyEntryRiskGuards(pos, context)
    this.applyTieredTargets(pos, order.quantity, context)
    return pos
  }

  private applyTieredTargets(pos: PaperPosition, orderQuantity: number, context?: TradeContext): void {
    if (!context) return

    let tiers: any = null

    if (pos.assetClass === 'EQUITY') {
      tiers = computeEquityTieredTargets({
        entryPrice: pos.avgEntryPrice,
        stopLoss: pos.aiStopLoss!,
        quantity: orderQuantity,
        aiTargets: context.aiIndexTargets,
      })
    } else {
      const daysToExpiry = pos.optionExpiry
        ? Math.max(0.001, (this.resolveExpiryCloseTimeMs(pos.optionExpiry) - Date.now()) / (1000 * 60 * 60 * 24))
        : 2

      tiers = computeTieredTargets({
        entryPrice: pos.avgEntryPrice,
        aiStopLoss: pos.aiStopLoss!,
        optionDelta: pos.optionDelta || context.optionDelta || 0.01,
        daysToExpiry,
        quantity: orderQuantity || 65,
        lotSize: context.lotSize || 1,
        ...(context.aiIndexTargets?.length ? { aiIndexTargets: context.aiIndexTargets } : {}),
        ...(context.currentIndexPrice ? { currentIndexPrice: context.currentIndexPrice } : {}),
      })
    }

    if (!tiers) return

    pos.t1Target = tiers.t1Target
    pos.t2Target = tiers.t2Target
    pos.t3Target = tiers.t3Target
    pos.t1Qty = tiers.t1Qty
    pos.t2Qty = tiers.t2Qty
    pos.t1Hit = false
    pos.t2Hit = false
  }

  private async reduceOrClosePosition(
    existing: PaperPosition,
    order: TradeOrder,
    context?: TradeContext
  ): Promise<void> {
    const directionMultiplier = existing.side === 'SELL' ? -1 : 1
    const pnl = (order.price! - existing.avgEntryPrice) * order.quantity * directionMultiplier
    existing.realizedPnL += pnl
    this.todayRealizedPnL += pnl
    existing.quantity -= order.quantity

    await this.syncPositionExitToDb(existing, order, context)

    if (existing.quantity <= 0) {
      this.positions.delete(order.symbol)
    }
  }

  private async syncPositionExitToDb(
    existing: PaperPosition,
    order: TradeOrder,
    context?: TradeContext
  ): Promise<void> {
    const openTrades = await this.repo.getOpenTrades(this.userId)
    const targetTrade = openTrades
      .filter((t) => t.symbol === order.symbol)
      .sort((a, b) => new Date(b.openedAt).getTime() - new Date(a.openedAt).getTime())[0]

    if (!targetTrade) {
      logger.warn(`⚠️ [DB SYNC ISSUE] Could not find OPEN trade in database for ${order.symbol} to close it.`)
      return
    }

    if (existing.quantity > 0) {
      await this.repo
        .recordPartialExit(
          targetTrade.id,
          order.symbol,
          order.price!,
          order.quantity,
          existing.quantity,
          context?.aiReasoning,
          context?.strategyContext?.agentType,
          order.side
        )
        .catch((err) => logger.error('❌ Failed to record partial exit in DB:', err))
      return
    }

    await this.repo
      .closeTrade(targetTrade.id, order.price!, context?.aiReasoning, context?.strategyContext?.agentType, {
        peakPrice: existing.peakPrice ?? 0,
        maxUnrealizedPnL: existing.maxUnrealizedPnL ?? 0,
        totalRealizedPnL: existing.realizedPnL,
      })
      .catch((err) => logger.error('❌ Failed to close trade in DB:', err))
  }

  async updatePrice(token: number, price: number) {
    if (!this.initialized) await this.initialize()

    const triggerFilled = await this.processPendingOrdersForToken(token, price, Date.now())
    const positionsUpdated = await this.updateActivePositionsForToken(token, price)

    if (triggerFilled || positionsUpdated) {
      this.emit('pnl_update', this.getAllPositions())
    }
  }

  private cancelPendingTriggerOrder(
    orderId: string,
    order: PendingTriggerOrder,
    title: string,
    message: string,
    type: 'info' | 'warning'
  ): void {
    order.status = 'CANCELLED'
    this.pendingTriggerOrders.delete(orderId)
    const recorded = this.orders.find((o) => o.id === orderId)
    if (recorded) recorded.status = 'CANCELLED'
    this.emit('notification', { title, message, type })
  }

  private async processPendingOrdersForToken(token: number, price: number, now: number): Promise<boolean> {
    const matchingOrders = Array.from(this.pendingTriggerOrders.entries()).filter(
      ([, order]) => order.token === token && order.status === 'PENDING'
    )

    let anyFilled = false
    await forEachSequentially(matchingOrders, async ([orderId, order]) => {
      const filled = await this.evaluatePendingTriggerOrder(orderId, order, price, now)
      if (filled) anyFilled = true
    })

    return anyFilled
  }

  private async evaluatePendingTriggerOrder(
    orderId: string,
    order: PendingTriggerOrder,
    price: number,
    now: number
  ): Promise<boolean> {
    if (now > order.expiresAt.getTime()) {
      logger.info(
        `⏳ [PAPER TRADE] Pending trigger order ${orderId} (${order.symbol}) expired after ${Math.round(order.ttlMs / 60000)}m TTL.`
      )
      this.cancelPendingTriggerOrder(
        orderId,
        order,
        '⏳ Trigger Order Expired',
        `${order.symbol} pending order expired (TTL exceeded).`,
        'info'
      )
      return false
    }

    if (price <= 0) return false

    // Structural invalidation check for wave pullback orders: cancel if price breaks stop-loss before filling
    if (order.context?.assetClass === 'EQUITY' && order.indexInvalidation !== undefined) {
      const isInvalidated =
        order.side === 'SELL' ? price >= order.indexInvalidation : price <= order.indexInvalidation
      if (isInvalidated) {
        this.cancelPendingTriggerOrder(
          orderId,
          order,
          '🧭 Wave Setup Invalidated',
          `${order.symbol} crossed structural stop ₹${order.indexInvalidation.toFixed(2)} before pullback entry.`,
          'warning'
        )
        return false
      }
    }

    const isTriggerTouched = order.side === 'SELL' ? price >= order.triggerPrice : price <= order.triggerPrice
    if (!isTriggerTouched) return false

    if (this.todayRealizedPnL <= this.maxDailyLoss) this.tradingHalted = true
    if (this.tradingHalted) {
      logger.warn(`⚠️ [PAPER TRADE] Trigger entry for ${order.symbol} cancelled: Trading halted for the day.`)
      this.cancelPendingTriggerOrder(
        orderId,
        order,
        '⚠️ Trigger Order Cancelled',
        `${order.symbol} pending order cancelled: Trading halted for the day.`,
        'warning'
      )
      return false
    }

    const buyValidation = this.validateBuyOrder({
      symbol: order.symbol,
      strike: order.strike,
      context: order.context,
    })
    if (!buyValidation.valid) {
      logger.warn(`⚠️ [PAPER TRADE] Trigger entry for ${order.symbol} cancelled prior to fill: ${buyValidation.error}`)
      this.cancelPendingTriggerOrder(
        orderId,
        order,
        '⚠️ Trigger Order Cancelled',
        `${order.symbol} pending order cancelled: ${buyValidation.error}`,
        'warning'
      )
      return false
    }

    await this.fillPendingTriggerOrder(orderId, order, price)
    return true
  }

  private async fillPendingTriggerOrder(orderId: string, order: PendingTriggerOrder, fillPrice: number): Promise<void> {
    logger.info(
      `🎯 [PAPER TRADE] Wave Pullback Trigger filled for ${order.symbol} (${order.side}): CMP ₹${fillPrice.toFixed(2)} (trigger ₹${order.triggerPrice.toFixed(2)})`
    )
    order.status = 'COMPLETE'
    this.pendingTriggerOrders.delete(orderId)

    const tradeContext = this.buildFilledTriggerContext(order, fillPrice)
    const filledQuantity =
      tradeContext.assetClass === 'EQUITY'
        ? this.calculateBuyQuantity({ price: fillPrice, context: tradeContext })
        : order.quantity

    const tradeOrder: TradeOrder = {
      id: order.id,
      symbol: order.symbol,
      token: order.token,
      side: order.side,
      quantity: filledQuantity,
      price: fillPrice,
      type: 'LIMIT',
      status: 'COMPLETE',
      timestamp: new Date(),
      ...(order.strike !== undefined ? { strike: order.strike } : {}),
    }

    const existingOrderRecord = this.orders.find((o) => o.id === order.id)
    if (existingOrderRecord) {
      existingOrderRecord.status = 'COMPLETE'
      existingOrderRecord.price = fillPrice
      existingOrderRecord.quantity = filledQuantity
      existingOrderRecord.timestamp = tradeOrder.timestamp
    } else {
      this.orders = [...this.orders, tradeOrder]
    }

    this.todayTradeCount++
    await this.updatePosition(tradeOrder, tradeContext)
    this.emitOrderEvents(tradeOrder, { side: order.side, symbol: order.symbol, context: tradeContext, isOpening: true })
  }

  private buildFilledTriggerContext(order: PendingTriggerOrder, fillPrice: number): TradeContext {
    if (order.context?.assetClass === 'EQUITY') {
      return {
        ...order.context,
      }
    }

    if (order.context?.assetClass === 'STOCK_OPTION') {
      const optionRiskPct = Number(process.env.STOCK_OPTION_RISK_PCT || 0.20)
      return {
        ...order.context,
        aiStopLoss: Number((fillPrice * (1 - optionRiskPct)).toFixed(2)),
        aiTarget: Number((fillPrice * 1.35).toFixed(2)),
      }
    }

    const optionRiskPoints = order.optionRiskPoints ?? 15
    const newSl = fillPrice - optionRiskPoints
    const dte = order.context?.optionExpiry ? getCalendarDaysToExpiry(order.context.optionExpiry) : undefined
    const profile = getExpiryRiskProfile(dte)
    const maxAllowedRiskPct =
      order.context?.strategyContext?.agentType === 'SCALPER'
        ? Math.min(0.2, profile.maxPremiumRiskPct)
        : profile.maxPremiumRiskPct
    const minAllowedSl = fillPrice * (1 - maxAllowedRiskPct)
    const recalculatedSl = Math.max(newSl, minAllowedSl)
    const rrr = order.riskRewardRatio ?? order.context?.strategyContext?.riskRewardRatio ?? 1.5
    const recalculatedTarget = fillPrice + optionRiskPoints * rrr

    return {
      ...order.context,
      aiStopLoss: recalculatedSl,
      aiTarget: recalculatedTarget,
      currentIndexPrice: order.currentIndexPrice,
      optionRiskPoints,
    }
  }

  private async updateActivePositionsForToken(token: number, price: number): Promise<boolean> {
    const matchingEntries = Array.from(this.positions.entries()).filter(([, pos]) => pos.token === token)
    if (matchingEntries.length === 0) return false

    await forEachSequentially(matchingEntries, async ([symbol, pos]) => {
      pos.currentPrice = price
      const directionMultiplier = pos.side === 'SELL' ? -1 : 1
      pos.unrealizedPnL = (price - pos.avgEntryPrice) * pos.quantity * directionMultiplier

      if (pos.side === 'SELL') {
        if (!pos.peakPrice || price < pos.peakPrice) pos.peakPrice = price
        const currentPeakPnL = (pos.avgEntryPrice - pos.peakPrice) * pos.quantity
        if (pos.maxUnrealizedPnL === undefined || currentPeakPnL > pos.maxUnrealizedPnL) {
          pos.maxUnrealizedPnL = currentPeakPnL
        }
        if (!this.exitingPositions.has(symbol)) {
          await this.processShortPriceTickExits(symbol, pos, price)
        }
        return
      }

      if (!pos.peakPrice || price > pos.peakPrice) pos.peakPrice = price
      const currentPeakPnL = (pos.peakPrice - pos.avgEntryPrice) * pos.quantity
      if (pos.maxUnrealizedPnL === undefined || currentPeakPnL > pos.maxUnrealizedPnL) {
        pos.maxUnrealizedPnL = currentPeakPnL
      }

      if (pos.side === 'BUY' && !this.exitingPositions.has(symbol)) {
        await this.processPriceTickExits(symbol, pos, price)
      }
    })

    return true
  }

  /**
   * Dual-track exit: closes long options whose underlying index has crossed the trade's
   * structural invalidation level, even if the premium stop has not been touched yet.
   */
  async updateIndexPrice(underlying: string, indexPrice: number): Promise<void> {
    const underlyingPattern = new RegExp(`^${underlying}\\d`)
    const invalidated = this.getAllPositions().filter(
      (pos) => underlyingPattern.test(pos.symbol) && this.isPositionInvalidatedByIndex(pos, indexPrice)
    )

    await forEachSequentially(invalidated, (pos) => this.exitOnIndexInvalidation(pos, indexPrice))
    this.cancelIndexInvalidatedPendingOrders(underlyingPattern, indexPrice)
  }

  private cancelIndexInvalidatedPendingOrders(underlyingPattern: RegExp, indexPrice: number): void {
    Array.from(this.pendingTriggerOrders.entries())
      .filter(([, order]) => this.isPendingOrderInvalidatedByIndex(order, underlyingPattern, indexPrice))
      .forEach(([orderId, order]) => {
        logger.info(
          `[PAPER TRADE] 🧭 Pending Trigger Order ${orderId} (${order.symbol}) cancelled: thesis invalidated by index (index ${indexPrice.toFixed(2)} crossed ${order.indexInvalidation?.toFixed(2)})`
        )
        this.cancelPendingTriggerOrder(
          orderId,
          order,
          '🧭 Pending Order Cancelled',
          `${order.symbol}: Thesis invalidated by index @ ${indexPrice.toFixed(2)}`,
          'warning'
        )
      })
  }

  private isPendingOrderInvalidatedByIndex(
    order: PendingTriggerOrder,
    underlyingPattern: RegExp,
    indexPrice: number
  ): boolean {
    if (order.status !== 'PENDING' || !underlyingPattern.test(order.symbol)) return false
    const optionType = getOptionType(order.symbol)
    if (!optionType || order.indexInvalidation === undefined) return false
    return isIndexInvalidated(optionType, indexPrice, order.indexInvalidation)
  }

  private isPositionInvalidatedByIndex(pos: PaperPosition, indexPrice: number): boolean {
    const optionType = getOptionType(pos.symbol)
    if (pos.side !== 'BUY' || !optionType || pos.indexInvalidation === undefined) return false
    if (this.exitingPositions.has(pos.symbol)) return false
    return isIndexInvalidated(optionType, indexPrice, pos.indexInvalidation)
  }

  private async exitOnIndexInvalidation(pos: PaperPosition, indexPrice: number): Promise<void> {
    const reason = `Index Invalidation (index ${indexPrice.toFixed(2)} crossed ${pos.indexInvalidation?.toFixed(2)})`
    logger.info(`[EXIT] 🧭 ${reason} for ${pos.symbol} @ ₹${pos.currentPrice.toFixed(2)}`)
    this.emit('notification', {
      title: `🧭 Index Invalidation Exit`,
      message: `${pos.symbol}: ${reason}`,
      type: 'warning',
    })
    await this.placeOrder({
      symbol: pos.symbol,
      token: pos.token,
      side: 'SELL',
      quantity: pos.quantity,
      price: pos.currentPrice,
      context: { aiReasoning: reason },
    })
  }

  private getRiskProfile(pos: PaperPosition): ExpiryRiskProfile {
    return getExpiryRiskProfile(getCalendarDaysToExpiry(pos.optionExpiry))
  }

  /**
   * Bounds worst-case premium loss by the expiry profile (an AI/ATR-derived stop can otherwise
   * sit at ₹0.05, i.e. no stop at all) and records the validated index invalidation level.
   */
  private applyEntryRiskGuards(pos: PaperPosition, context?: TradeContext): void {
    if (pos.assetClass === 'EQUITY') {
      if (pos.side === 'SELL') {
        const maxShortSl = pos.avgEntryPrice * 1.03
        if (pos.aiStopLoss === undefined || pos.aiStopLoss > maxShortSl || pos.aiStopLoss <= pos.avgEntryPrice) {
          pos.aiStopLoss = Number((pos.avgEntryPrice * 1.015).toFixed(2))
        }
        return
      }
      const minEquitySl = pos.avgEntryPrice * 0.97
      if (pos.aiStopLoss === undefined || pos.aiStopLoss < minEquitySl) {
        pos.aiStopLoss = Number((pos.avgEntryPrice * 0.985).toFixed(2))
      }
      return
    }

    this.enforcePremiumStopFloor(pos)

    const indexInvalidation = resolveIndexInvalidation(
      getOptionType(pos.symbol),
      context?.strategyContext?.indexSl,
      context?.currentIndexPrice
    )
    if (indexInvalidation !== undefined) pos.indexInvalidation = indexInvalidation
  }

  private enforcePremiumStopFloor(pos: PaperPosition): void {
    if (pos.assetClass === 'STOCK_OPTION') {
      const optionRiskPct = Number(process.env.STOCK_OPTION_RISK_PCT || 0.20)
      const stockOptionFloor = Number((pos.avgEntryPrice * (1 - optionRiskPct)).toFixed(2))
      if (pos.aiStopLoss !== undefined && pos.aiStopLoss >= stockOptionFloor) return
      pos.aiStopLoss = stockOptionFloor
      return
    }

    const profile = this.getRiskProfile(pos)
    const premiumFloor = getPremiumStopFloor(pos.avgEntryPrice, profile)
    if (pos.aiStopLoss !== undefined && pos.aiStopLoss >= premiumFloor) return

    logger.info(
      `[Risk Guard] ${pos.symbol} (${profile.bucket}): premium SL ${pos.aiStopLoss?.toFixed(2) ?? '—'} → ${premiumFloor.toFixed(2)} (max ${profile.maxPremiumRiskPct * 100}% premium risk)`
    )
    pos.aiStopLoss = premiumFloor
  }

  private async exitOnPeakRetract(pos: PaperPosition, price: number): Promise<void> {
    const peakPrice = pos.peakPrice ?? price
    const bucket = this.getRiskProfile(pos).bucket
    const exitSide: OrderSide = pos.side === 'SELL' ? 'BUY' : 'SELL'
    logger.info(
      `[EXIT] 🛡️ Peak Retract Guard (${bucket}) triggered for ${pos.symbol} @ ₹${price.toFixed(2)} (Peak: ₹${peakPrice.toFixed(2)})`
    )
    this.emit('notification', {
      title: `🛡️ Peak Retract Exit (Profit Protected)`,
      message: `${pos.symbol}: Exited @ ₹${price.toFixed(2)} to protect peak profit (Peak: ₹${peakPrice.toFixed(2)}, ${bucket})`,
      type: 'info',
    })
    await this.placeOrder({
      symbol: pos.symbol,
      token: pos.token,
      side: exitSide,
      quantity: pos.quantity,
      price: price,
      context: {
        aiReasoning: `Peak Profit Retract Guard ${bucket} (MFE Protection from peak ₹${peakPrice.toFixed(2)})`,
      },
    })
  }

  private async exitOnStopLossHit(pos: PaperPosition, price: number, entryPrice: number): Promise<void> {
    const isProfitable = pos.side === 'SELL' ? price <= entryPrice : price >= entryPrice
    const exitSide: OrderSide = pos.side === 'SELL' ? 'BUY' : 'SELL'
    const title = isProfitable ? '🔒 Trailing Stop Hit (Profit Locked)' : '⛔ Stop-Loss Hit'
    const reason = isProfitable ? 'Trailing Stop Hit (Locked Profit)' : 'Stop-Loss hit'
    const type = isProfitable ? 'info' : 'error'

    logger.info(`[EXIT] ${title} for ${pos.symbol} @ ${price} (SL: ${pos.aiStopLoss})`)
    this.emit('notification', {
      title,
      message: `${pos.symbol} exited @ ₹${price.toFixed(2)} (${isProfitable ? 'Profit locked' : 'SL'}: ₹${pos.aiStopLoss?.toFixed(2)})`,
      type,
    })
    await this.placeOrder({
      symbol: pos.symbol,
      token: pos.token,
      side: exitSide,
      quantity: pos.quantity,
      price: price,
      context: { aiReasoning: reason },
    })
  }

  private resolveProfitRatchetTiers(pos: PaperPosition) {
    if (pos.assetClass === 'EQUITY') return EQUITY_PROFIT_RATCHET_TIERS
    if (pos.assetClass === 'STOCK_OPTION') return STOCK_OPTION_PROFIT_RATCHET_TIERS
    return PEAK_PROFIT_RATCHET_TIERS
  }

  private isOptionStagnant(pos: PaperPosition, price: number): boolean {
    if (pos.assetClass !== 'STOCK_OPTION') return false
    const holdMs = Date.now() - pos.timestamp.getTime()
    const maxHoldMs = Number(process.env.OPTION_STAGNATION_HOLD_MINS || 60) * 60 * 1000
    if (holdMs < maxHoldMs) return false
    const gainPct = (price - pos.avgEntryPrice) / pos.avgEntryPrice
    return gainPct < 0.04
  }

  private isIntradayEquityStagnant(pos: PaperPosition, price: number): boolean {
    if (pos.assetClass !== 'EQUITY') return false
    if (pos.product === 'CNC') return false

    const holdMs = Date.now() - pos.timestamp.getTime()
    const maxHoldMs = Number(process.env.INTRADAY_EQUITY_STAGNATION_MINS || 90) * 60 * 1000
    if (holdMs < maxHoldMs) return false

    const directionMultiplier = pos.side === 'SELL' ? -1 : 1
    const gainPct = ((price - pos.avgEntryPrice) / pos.avgEntryPrice) * directionMultiplier
    return gainPct < 0.0025
  }

  private async exitOnOptionStagnation(pos: PaperPosition, price: number): Promise<void> {
    const holdMins = Math.round((Date.now() - pos.timestamp.getTime()) / 60000)
    logger.info(`[EXIT] ⏱️ Stagnant Option Timeout (${holdMins}m Rule) for ${pos.symbol} @ ₹${price.toFixed(2)}`)
    this.emit('notification', {
      title: '⏱️ Option Stagnation Cutoff',
      message: `${pos.symbol} exited @ ₹${price.toFixed(2)} to protect against theta decay (held ${holdMins}m with <4% gain)`,
      type: 'info',
    })
    await this.placeOrder({
      symbol: pos.symbol,
      token: pos.token,
      side: 'SELL',
      quantity: pos.quantity,
      price: price,
      context: { aiReasoning: `Stagnant Option Timeout (${holdMins}m Rule - Theta Protection)` },
    })
  }

  private async exitOnEquityStagnation(pos: PaperPosition, price: number): Promise<void> {
    const holdMins = Math.round((Date.now() - pos.timestamp.getTime()) / 60000)
    const exitSide: OrderSide = pos.side === 'SELL' ? 'BUY' : 'SELL'
    logger.info(`[EXIT] ⏱️ Intraday Equity Stagnation Timeout (${holdMins}m Rule) for ${pos.symbol} @ ₹${price.toFixed(2)}`)
    this.emit('notification', {
      title: '⏱️ Equity Stagnation Cutoff',
      message: `${pos.symbol} exited @ ₹${price.toFixed(2)}: Intraday momentum stalled after ${holdMins}m. Freeing capital.`,
      type: 'info',
    })
    await this.placeOrder({
      symbol: pos.symbol,
      token: pos.token,
      side: exitSide,
      quantity: pos.quantity,
      price: price,
      context: { aiReasoning: `Intraday Equity Stagnation Timeout (${holdMins}m Rule)` },
    })
  }

  private applyEquityHalfTargetRatchet(pos: PaperPosition, peakPrice: number, entryPrice: number): void {
    if (pos.assetClass !== 'EQUITY' || pos.t1Hit || !pos.t1Target || pos.aiStopLoss === undefined) return
    if (pos.side === 'SELL') {
      const halfTargetDistance = (entryPrice - pos.t1Target) * 0.5
      if (halfTargetDistance <= 0) return
      const greenBuffer = Number((halfTargetDistance * 0.20).toFixed(2))
      const targetSl = Number((entryPrice - greenBuffer).toFixed(2))
      if (peakPrice <= entryPrice - halfTargetDistance && pos.aiStopLoss > targetSl) {
        pos.aiStopLoss = targetSl
        pos.trailingSlLocked = targetSl
        logger.info(
          `[PaperTrader] 🛡️ Short Half-Target Profit Ratchet for ${pos.symbol}: Low ₹${peakPrice.toFixed(2)} reached 50% of T1. SL ratcheted to ₹${targetSl.toFixed(2)} (+₹${greenBuffer.toFixed(2)} profit buffer)`
        )
      }
      return
    }

    const halfTargetDistance = (pos.t1Target - entryPrice) * 0.5
    if (halfTargetDistance <= 0) return
    const greenBuffer = Number((halfTargetDistance * 0.20).toFixed(2))
    const targetSl = Number((entryPrice + greenBuffer).toFixed(2))
    if (peakPrice >= entryPrice + halfTargetDistance && pos.aiStopLoss < targetSl) {
      pos.aiStopLoss = targetSl
      pos.trailingSlLocked = targetSl
      logger.info(
        `[PaperTrader] 🛡️ Half-Target Profit Ratchet for ${pos.symbol}: Peak ₹${peakPrice.toFixed(2)} reached 50% of T1. SL ratcheted to ₹${targetSl.toFixed(2)} (+₹${greenBuffer.toFixed(2)} profit buffer)`
      )
      this.emit('notification', {
        title: '🛡️ Half-Target Profit Ratchet',
        message: `${pos.symbol}: Reached 50% of T1. SL locked at ₹${targetSl.toFixed(2)} (+₹${greenBuffer.toFixed(2)} buffer).`,
        type: 'info',
      })
    }
  }

  /**
   * Evaluates price-tick exits for Short (SELL) cash equity positions:
   * - Half-target breakeven ratchet (when price drops 50% toward T1)
   * - 90m intraday stagnation timeout
   * - Stop-loss hit (price >= aiStopLoss)
   * - Downward tiered targets (price <= t1Target, t2Target, t3Target)
   */
  private async processShortPriceTickExits(symbol: string, pos: PaperPosition, price: number): Promise<void> {
    const entryPrice = pos.avgEntryPrice
    const peakLowPrice = pos.peakPrice ?? pos.currentPrice
    const ratchet = getShortRatchetedStopLoss(entryPrice, peakLowPrice, EQUITY_PROFIT_RATCHET_TIERS)

    if (ratchet && (pos.aiStopLoss === undefined || ratchet.targetSl < pos.aiStopLoss)) {
      const { targetSl, peakGainPct } = ratchet
      const oldSl = pos.aiStopLoss?.toFixed(2) ?? '—'
      pos.aiStopLoss = targetSl
      pos.trailingSlLocked = targetSl
      logger.info(
        `[PaperTrader] 📉 Short Peak Profit Ratchet: ${symbol} low ₹${peakLowPrice.toFixed(2)} (+${(peakGainPct * 100).toFixed(1)}%). SL ratcheted down from ₹${oldSl} to ₹${targetSl.toFixed(2)}`
      )
    }

    this.applyEquityHalfTargetRatchet(pos, peakLowPrice, entryPrice)

    if (this.isIntradayEquityStagnant(pos, price)) {
      await this.exitOnEquityStagnation(pos, price)
      return
    }

    if (pos.aiStopLoss && price >= pos.aiStopLoss) {
      await this.exitOnStopLossHit(pos, price, entryPrice)
      return
    }

    if (pos.t1Target && !pos.t1Hit && price <= pos.t1Target) {
      await this.handleT1TargetHit(symbol, pos, price)
      return
    }
    if (pos.t2Target && pos.t1Hit && !pos.t2Hit && price <= pos.t2Target) {
      await this.handleT2TargetHit(symbol, pos, price)
      return
    }
    if (pos.t3Target && pos.t2Hit && price <= pos.t3Target) {
      await this.handleT3TargetHit(symbol, pos, price)
      return
    }
    if (!pos.t1Target && pos.aiTarget && price <= pos.aiTarget) {
      await this.handleSingleTargetHit(symbol, pos, price)
    }
  }

  private async processPriceTickExits(symbol: string, pos: PaperPosition, price: number): Promise<void> {
    const entryPrice = pos.avgEntryPrice
    const peakPrice = pos.peakPrice ?? pos.currentPrice
    const tiers = this.resolveProfitRatchetTiers(pos)
    const ratchet = getRatchetedStopLoss(entryPrice, peakPrice, tiers)

    if (ratchet && (pos.aiStopLoss === undefined || ratchet.targetSl > pos.aiStopLoss)) {
      const { targetSl, peakGainPct } = ratchet
      const oldSl = pos.aiStopLoss?.toFixed(2) ?? '—'
      pos.aiStopLoss = targetSl
      pos.trailingSlLocked = targetSl
      logger.info(
        `[PaperTrader] 📈 Peak Profit Ratchet: ${symbol} peak price ₹${peakPrice.toFixed(2)} (+${(peakGainPct * 100).toFixed(1)}%). SL ratcheted from ₹${oldSl} to ₹${targetSl.toFixed(2)}`
      )
      this.emit('notification', {
        title: `📈 Peak Profit Locked`,
        message: `${symbol}: Peak +${(peakGainPct * 100).toFixed(1)}% gain (₹${peakPrice.toFixed(2)}). SL ratcheted to ₹${targetSl.toFixed(2)}`,
        type: 'info',
      })
    }

    this.applyEquityHalfTargetRatchet(pos, peakPrice, entryPrice)

    if (this.isOptionStagnant(pos, price)) {
      await this.exitOnOptionStagnation(pos, price)
      return
    }

    if (this.isIntradayEquityStagnant(pos, price)) {
      await this.exitOnEquityStagnation(pos, price)
      return
    }

    if (isRetractGuardTriggered(entryPrice, peakPrice, price, this.getRiskProfile(pos))) {
      await this.exitOnPeakRetract(pos, price)
      return
    }

    if (pos.aiStopLoss && price <= pos.aiStopLoss) {
      await this.exitOnStopLossHit(pos, price, entryPrice)
      return
    }

    await this.processTieredProfitExits(symbol, pos, price)
  }

  private async processTieredProfitExits(symbol: string, pos: PaperPosition, price: number): Promise<void> {
    if (pos.t1Target && !pos.t1Hit && price >= pos.t1Target) {
      await this.handleT1TargetHit(symbol, pos, price)
      return
    }
    if (pos.t2Target && pos.t1Hit && !pos.t2Hit && price >= pos.t2Target) {
      await this.handleT2TargetHit(symbol, pos, price)
      return
    }
    if (pos.t3Target && pos.t2Hit && price >= pos.t3Target) {
      await this.handleT3TargetHit(symbol, pos, price)
      return
    }
    if (!pos.t1Target && pos.aiTarget && price >= pos.aiTarget) {
      await this.handleSingleTargetHit(symbol, pos, price)
    }
  }

  private async handleT1TargetHit(symbol: string, pos: PaperPosition, price: number): Promise<void> {
    pos.t1Hit = true
    const prevSl = pos.aiStopLoss?.toFixed(2) ?? '—'
    const exitSide: OrderSide = pos.side === 'SELL' ? 'BUY' : 'SELL'

    if (pos.t1Qty && pos.t1Qty > 0) {
      pos.aiStopLoss =
        pos.side === 'SELL'
          ? Math.min(pos.aiStopLoss || Infinity, pos.avgEntryPrice)
          : Math.max(pos.aiStopLoss || 0, pos.avgEntryPrice)
      pos.trailingSlLocked = pos.aiStopLoss
      logger.info(`[EXIT] 🥇 T1 hit for ${symbol} @ ₹${price} — exiting ${pos.t1Qty}qty, SL→breakeven`)
      this.emit('notification', {
        title: `🥇 T1 Hit — Partial Booked`,
        message: `${symbol}: Closed ${pos.t1Qty}qty @ ₹${price.toFixed(2)}. SL moved to breakeven (was ₹${prevSl})`,
        type: 'success',
      })
      await this.placeOrder({
        symbol: pos.symbol,
        token: pos.token,
        side: exitSide,
        quantity: pos.t1Qty,
        price,
        context: { aiReasoning: `T1 target hit @ ₹${pos.t1Target}` },
      })
      return
    }

    // 1-lot position: no partial exit possible, lock 50% of the T1 gain cushion
    const cushionedSl = parseFloat((pos.avgEntryPrice + 0.5 * (price - pos.avgEntryPrice)).toFixed(2))
    pos.aiStopLoss =
      pos.side === 'SELL' ? Math.min(pos.aiStopLoss || Infinity, cushionedSl) : Math.max(pos.aiStopLoss || 0, cushionedSl)
    pos.trailingSlLocked = pos.aiStopLoss
    logger.info(
      `[T1] 🥇 T1 hit for ${symbol} @ ₹${price} — SL moved to ₹${cushionedSl.toFixed(2)} (1-lot: 50% gain cushion)`
    )
    this.emit('notification', {
      title: `🥇 T1 — Profit Cushion Locked`,
      message: `${symbol} @ ₹${price.toFixed(2)} crossed T1. SL moved to ₹${cushionedSl.toFixed(2)} (50% T1 gain locked).`,
      type: 'info',
    })
    this.emit('pnl_update', this.getAllPositions())
  }

  private async handleT2TargetHit(symbol: string, pos: PaperPosition, price: number): Promise<void> {
    pos.t2Hit = true
    const prevSl = pos.aiStopLoss?.toFixed(2) ?? '—'
    const exitSide: OrderSide = pos.side === 'SELL' ? 'BUY' : 'SELL'
    if (pos.t1Target) {
      pos.aiStopLoss =
        pos.side === 'SELL'
          ? Math.min(pos.aiStopLoss || Infinity, pos.t1Target)
          : Math.max(pos.aiStopLoss || 0, pos.t1Target)
      pos.trailingSlLocked = pos.aiStopLoss
    }

    if (pos.t2Qty && pos.t2Qty > 0) {
      logger.info(`[EXIT] 🥈 T2 hit for ${symbol} @ ₹${price} — exiting ${pos.t2Qty}qty, SL→T1`)
      this.emit('notification', {
        title: `🥈 T2 Hit — Profit Locked`,
        message: `${symbol}: Closed ${pos.t2Qty}qty @ ₹${price.toFixed(2)}. SL locked at T1 ₹${pos.t1Target?.toFixed(2)} (was ₹${prevSl})`,
        type: 'success',
      })
      await this.placeOrder({
        symbol: pos.symbol,
        token: pos.token,
        side: exitSide,
        quantity: pos.t2Qty,
        price,
        context: { aiReasoning: `T2 target hit @ ₹${pos.t2Target}` },
      })
      return
    }

    logger.info(`[T2] 🥈 T2 hit for ${symbol} @ ₹${price} — SL locked at T1 level`)
    this.emit('notification', {
      title: `🥈 T2 — Profit Locked at T1`,
      message: `${symbol} @ ₹${price.toFixed(2)}. SL locked at ₹${pos.t1Target?.toFixed(2)}. Runner heading for T3.`,
      type: 'info',
    })
    this.emit('pnl_update', this.getAllPositions())
  }

  private async handleT3TargetHit(symbol: string, pos: PaperPosition, price: number): Promise<void> {
    const exitSide: OrderSide = pos.side === 'SELL' ? 'BUY' : 'SELL'
    logger.info(`[EXIT] 🏆 T3 hit for ${symbol} @ ₹${price} — exiting remaining ${pos.quantity}qty`)
    this.emit('notification', {
      title: `🏆 Full Target Booked!`,
      message: `${symbol}: Remaining ${pos.quantity}qty exited @ ₹${price.toFixed(2)} (T3: ₹${pos.t3Target!.toFixed(2)})`,
      type: 'success',
    })
    await this.placeOrder({
      symbol: pos.symbol,
      token: pos.token,
      side: exitSide,
      quantity: pos.quantity,
      price,
      context: { aiReasoning: `T3 hard exit @ ₹${pos.t3Target}` },
    })
  }

  private async handleSingleTargetHit(symbol: string, pos: PaperPosition, price: number): Promise<void> {
    const exitSide: OrderSide = pos.side === 'SELL' ? 'BUY' : 'SELL'
    logger.info(`[EXIT] 🎯 Target reached for ${symbol} @ ${price} (Target: ${pos.aiTarget})`)
    this.emit('notification', {
      title: `🎯 Target Booked!`,
      message: `${symbol} exited @ ₹${price.toFixed(2)} (Target: ₹${pos.aiTarget!.toFixed(2)})`,
      type: 'success',
    })
    await this.placeOrder({
      symbol: pos.symbol,
      token: pos.token,
      side: exitSide,
      quantity: pos.quantity,
      price,
      context: { aiReasoning: 'Target reached' },
    })
  }

  getAllPositions(): PaperPosition[] {
    return Array.from(this.positions.values())
  }

  getOrders(): TradeOrder[] {
    return this.orders
  }
}

export const paperTrader = new PaperTrader('cli-user', null as any)
