import { EventEmitter } from 'node:events'
import { PaperTrader } from './paper-trader.js'
import { createTicker } from '../data/kite-ticker.js'
import { createKiteClient, getInstrumentToken, getOptionToken } from '../data/kite.js'
import { LiveAnalyzer, type AnalysisLevels } from '../analysis/live.js'
import { candleBuilder } from '../data/candle-builder.js'
import { gtiTracker } from '../indicators/gti-tracker.js'
import { runAnalysis } from '../analysis/trade.js'
import { eventRepo, gtiRepo, userRepo } from '../db/repositories/container.js'
import { isMarketOpen } from '../utils/market-hours.js'
import type { Connect as KiteConnect } from 'kiteconnect'
import type { AIMacroTrend, TradingAgentType } from '../ai/types.js'
import { getCalendarDaysToExpiry, getExpiryRiskProfile } from './expiry-risk-profile.js'
import type { PendingTriggerOrder, TradeContext } from './types.js'

/**
 * Fix 1: Calculate pre-breakout baseline option price adjusted for directional index spike.
 * For CE: Option surges when triggerIndexPrice > baseIndexPrice.
 * For PE: Option surges when triggerIndexPrice < baseIndexPrice.
 */
export function calculateBaseSignalPrice(params: {
  optionType: 'CE' | 'PE'
  preLlmOptionLtp?: number | undefined
  entryPrice: number
  estimatedDelta: number
  baseIndexPrice: number
  triggerIndexPrice: number
}): number {
  const { optionType, preLlmOptionLtp, entryPrice, estimatedDelta, baseIndexPrice, triggerIndexPrice } = params

  const indexSpike =
    optionType === 'CE'
      ? Math.max(0, triggerIndexPrice - baseIndexPrice)
      : Math.max(0, baseIndexPrice - triggerIndexPrice)

  if (preLlmOptionLtp && indexSpike > 0) {
    const rawBase = preLlmOptionLtp - estimatedDelta * indexSpike
    const rounded = Math.round(rawBase * 20) / 20
    return Math.max(0.05, Math.round(rounded * 100) / 100)
  }

  return preLlmOptionLtp || entryPrice
}

/**
 * Fix 2: Calculate bounded index/option risk and target anchored to bounded risk and DTE floor.
 */
export function calculateBoundedRiskAndTarget(params: {
  spotPrice: number
  stopLoss: number
  atr14: number
  agentType: TradingAgentType
  estimatedDelta: number
  signalPrice: number
  riskRewardRatio?: number | undefined
  expiry?: Date | string | undefined
}): {
  indexRiskPoints: number
  optionRiskPoints: number
  calculatedSl: number
  calculatedTarget: number
} {
  const { spotPrice, stopLoss, atr14, agentType, estimatedDelta, signalPrice, riskRewardRatio = 1.5, expiry } = params

  const minAtrRisk = 1.5 * atr14
  const maxAtrRisk = agentType === 'SCALPER' ? 2.5 * atr14 : 4.0 * atr14
  const rawStructuralRisk = Math.abs(spotPrice - stopLoss)
  // Guard against LLM returning an option price / points offset (e.g. 109.8) instead of index level
  const isValidIndexSl = stopLoss > spotPrice * 0.9 && stopLoss < spotPrice * 1.1
  const structuralRiskPoints = isValidIndexSl ? rawStructuralRisk : minAtrRisk
  const indexRiskPoints = Math.min(Math.max(structuralRiskPoints, minAtrRisk), maxAtrRisk)

  const optionRiskPoints = indexRiskPoints * estimatedDelta

  // Anchor Target and SL to the bounded optionRiskPoints
  const rrr = riskRewardRatio || 1.5
  const rawTarget = signalPrice + optionRiskPoints * rrr
  const calculatedTarget = agentType === 'SCALPER' ? Math.min(rawTarget, signalPrice * 1.5) : rawTarget

  // Enforce DTE-aware premium floor protection (prevents 0.05 / 100% loss trap)
  const dte = getCalendarDaysToExpiry(expiry)
  const riskProfile = getExpiryRiskProfile(dte)
  const maxAllowedRiskPct =
    agentType === 'SCALPER' ? Math.min(0.2, riskProfile.maxPremiumRiskPct) : riskProfile.maxPremiumRiskPct
  const minAllowedSl = signalPrice * (1 - maxAllowedRiskPct)
  const calculatedSl = Math.max(signalPrice - optionRiskPoints, minAllowedSl)

  return {
    indexRiskPoints,
    optionRiskPoints,
    calculatedSl,
    calculatedTarget,
  }
}

/**
 * Predicate to evaluate whether entry slippage or point distance warrants queueing a trigger order.
 */
export function isEntrySpikeTriggered(params: {
  entryPrice: number
  baseSignalPrice: number
  optionRiskPoints: number
  maxSlippagePct?: number | undefined
}): boolean {
  const maxSlippagePct = params.maxSlippagePct ?? Number(process.env.MAX_ENTRY_SLIPPAGE_PCT || 5)
  return (
    params.entryPrice > params.baseSignalPrice * (1 + maxSlippagePct / 100) ||
    params.entryPrice - params.baseSignalPrice > 0.35 * params.optionRiskPoints
  )
}

export class UserSession extends EventEmitter {
  public userId: string
  public accessToken: string
  public apiKey: string | undefined
  public kc: KiteConnect
  public ticker: ReturnType<typeof createTicker>
  public paperTrader: PaperTrader
  public tokenExpired: boolean = false

  // ── Analysis State (session-level, browser-independent) ─────────────────
  public analyzer: LiveAnalyzer
  public watchedSymbol: string = ''
  public watchedToken: number = 0
  public watchMode: 'intraday' | 'swing' = 'intraday'
  private isAnalyzing: boolean = false
  private lastDecision: any = null
  private candleCloseHandler: ((data: any) => void) | null = null

  constructor(userId: string, accessToken: string, apiKey?: string, tradeMode: 'PAPER' | 'REAL' = 'PAPER') {
    super()
    this.userId = userId
    this.accessToken = accessToken
    this.apiKey = apiKey
    this.kc = createKiteClient(accessToken, apiKey)
    this.ticker = createTicker(accessToken, apiKey)
    this.paperTrader = new PaperTrader(userId, this.kc)
    this.paperTrader.setTradeMode(tradeMode)
    this.analyzer = new LiveAnalyzer()
  }

  async initialize() {
    await this.paperTrader.initialize()
    this.setupTickerListeners()
    this.ticker.connect()
    await this.autoWatch()
  }

  // ── Watch: Configure session-level analysis for a symbol ────────────────
  async watch(symbol: string, levels?: AnalysisLevels, mode?: 'intraday' | 'swing') {
    const token = await getInstrumentToken(this.kc, symbol)

    if (!token) {
      console.error(`[UserSession] Token not found for ${symbol}`)
      this.emit('watch_error', { message: `Token not found for ${symbol}` })
      return
    }

    await candleBuilder.seedFromKite(this.kc, token)

    // Cleanup previous analyzer listeners
    this.analyzer.off('breakout', this.onBreakout)

    // Reset analyzer with fresh state
    this.analyzer = new LiveAnalyzer()
    this.watchedSymbol = symbol
    this.watchedToken = token
    this.watchMode = mode || 'intraday'

    if (!isMarketOpen()) {
      console.log(`[UserSession] Market is closed. Watch registered for ${symbol} in read-only mode.`)
      this.emit('market_closed', { message: 'Market is closed. Operating in read-only mode.' })
    } else {
      if (levels) {
        this.analyzer.setLevels(levels)
      }
      this.analyzer.on('breakout', this.onBreakout)
      console.log(`[UserSession] 🔭 Watching ${symbol} (token: ${token}, mode: ${this.watchMode})`)
    }

    // Subscribe ticker to watched symbol + open position tokens
    const positionTokens = this.paperTrader
      .getAllPositions()
      .map((p) => p.token)
      .filter((t) => !!t)
    const tokensToSubscribe = Array.from(new Set([token, ...positionTokens]))

    this.ticker.subscribe(tokensToSubscribe)
    this.ticker.setMode(this.ticker.modeFull, tokensToSubscribe)

    // Persist watch config to DB
    try {
      await userRepo.updateWatchConfig(this.userId, symbol, this.watchMode)
    } catch (err) {
      console.error(`[UserSession] Failed to persist watch config for ${symbol}:`, err)
    }

    this.emit('watching', { symbol, token })
    this.emit('portfolio_sync', this.paperTrader.getAllPositions())
  }

  async autoWatch() {
    try {
      const config = await userRepo.getWatchConfig(this.userId)
      if (config?.watchedSymbol && isMarketOpen()) {
        console.log(`[UserSession] Auto-watching ${config.watchedSymbol} on initialization...`)
        await this.watch(config.watchedSymbol, undefined, (config.watchedMode as 'intraday' | 'swing') || 'intraday')
      }
    } catch (err) {
      console.error(`[UserSession] Failed to auto-watch on initialization:`, err)
    }
  }

  // ── Breakout Handler (session-level, autonomous) ────────────────────────
  private onBreakout = async (context: any) => {
    if (this.tokenExpired) {
      console.log(`[UserSession] Token is expired. Aborting breakout analysis for ${this.watchedSymbol}.`)
      return
    }

    if (this.isAnalyzing) {
      console.log(
        `[UserSession] AI is already analyzing for ${this.watchedSymbol}. Dropping concurrent breakout event.`
      )
      return
    }
    this.isAnalyzing = true

    try {
      console.log(`[UserSession] 🔥 Breakout detected for ${this.watchedSymbol}: ${context.reason}`)
      this.emit('breakout', context)

      await eventRepo.saveEvent({
        symbol: this.watchedSymbol,
        reason: context.reason,
        price: context.tick.last_price,
        timestamp: new Date().toISOString(),
        metadata: { tick: context.tick },
      })

      const analysisResult = await runAnalysis(
        this.kc,
        this.watchedSymbol,
        this.watchMode,
        context,
        this.lastDecision,
        undefined,
        this.userId
      )
      this.lastDecision = analysisResult.aiDecision
      this.emit('analysis', analysisResult)

      await this.executeOptionSignal(analysisResult, context)
    } catch (err: any) {
      this.handleBreakoutError(err)
    } finally {
      this.isAnalyzing = false
    }
  }

  private resolveEstimatedDelta(
    optionDelta: number | undefined,
    strike: number | null | undefined,
    spotPrice: number,
    type: 'CE' | 'PE'
  ): number {
    if (optionDelta) return Math.abs(optionDelta)
    if (!strike || !spotPrice) return 0.5
    const isItm = type === 'CE' ? spotPrice > strike : spotPrice < strike
    return isItm ? 0.75 : 0.4
  }

  private async executeOptionSignal(
    analysisResult: Awaited<ReturnType<typeof runAnalysis>>,
    context: any
  ): Promise<void> {
    const { tf15m: tf, aiDecision: decision, vix, agentType, optionsAnalysis } = analysisResult
    if (!decision || decision.optionAction === 'NONE') return

    const type = decision.optionAction === 'BUY_CE' ? 'CE' : 'PE'
    const option = await getOptionToken(this.kc, this.watchedSymbol, decision.strike || 0, type)
    if (!option) return

    console.log(`[UserSession] Executing Paper Trade for ${option.symbol} (${agentType} Agent)...`)
    this.ticker.subscribe([option.token])
    this.ticker.setMode(this.ticker.modeFull, [option.token])

    const quote = await this.kc.getQuote([`NFO:${option.symbol}`])
    const entryPrice = quote[`NFO:${option.symbol}`]?.last_price || 0
    if (entryPrice <= 0) return

    const optionRow = optionsAnalysis?.rows?.find((r) => r.strike === decision.strike && r.type === type)
    const estimatedDelta = this.resolveEstimatedDelta(optionRow?.greeks?.delta, decision.strike, tf.price, type)

    const baseIndexPrice =
      Array.isArray(context.recentTicks) && context.recentTicks.length > 0
        ? context.recentTicks[0].last_price
        : context.tick?.last_price || tf.price
    const triggerIndexPrice = context.tick?.last_price || tf.price

    const baseSignalPrice = calculateBaseSignalPrice({
      optionType: type,
      preLlmOptionLtp: optionRow?.ltp,
      entryPrice,
      estimatedDelta,
      baseIndexPrice,
      triggerIndexPrice,
    })

    const atr14 = tf.atr14 || analysisResult.dailyContext?.atr14 || 20
    const { optionRiskPoints, calculatedSl, calculatedTarget } = calculateBoundedRiskAndTarget({
      spotPrice: tf.price,
      stopLoss: decision.stopLoss,
      atr14,
      agentType,
      estimatedDelta,
      signalPrice: baseSignalPrice,
      riskRewardRatio: decision.riskRewardRatio || 1.5,
      expiry: option.expiry,
    })

    if (entryPrice >= calculatedTarget) {
      console.warn(
        `⚠️ [UserSession] Entry BLOCKED: CMP ₹${entryPrice.toFixed(2)} has already reached or exceeded the target ₹${calculatedTarget.toFixed(2)}.`
      )
      return
    }

    const tradeContext: TradeContext = {
      optionExpiry: option.expiry.toISOString(),
      optionDelta: estimatedDelta,
      aiReasoning: decision.reason,
      aiConfidence: decision.confidence,
      aiStrike: decision.strike || undefined,
      aiSetup: decision.setup,
      strategyContext: {
        macroTrend: decision.macroTrend as AIMacroTrend,
        indexSl: decision.stopLoss,
        agentType,
        riskRewardRatio: decision.riskRewardRatio || 1.5,
      },
      vixLevel: vix.current,
      rsiLevel: tf.rsi,
      trend15m: tf.trend,
      aiStopLoss: calculatedSl,
      aiTarget: calculatedTarget,
      aiIndexTargets: decision.targets?.length ? decision.targets : undefined,
      currentIndexPrice: tf.price,
      lotSize: analysisResult.lotSize,
      optionRiskPoints,
      baseSignalPrice,
      triggerPrice: baseSignalPrice,
    }

    const maxSlippagePct = Number(process.env.MAX_ENTRY_SLIPPAGE_PCT || 5)
    if (isEntrySpikeTriggered({ entryPrice, baseSignalPrice, optionRiskPoints, maxSlippagePct })) {
      await this.queueSpikeTriggerOrder({
        option,
        decision,
        lotSize: analysisResult.lotSize,
        spotPrice: tf.price,
        entryPrice,
        baseSignalPrice,
        optionRiskPoints,
        estimatedDelta,
        tradeContext,
      })
      return
    }

    await this.paperTrader.placeOrder({
      symbol: option.symbol,
      token: option.token,
      strike: decision.strike || undefined,
      side: 'BUY',
      quantity: 1,
      price: entryPrice,
      context: tradeContext,
    })
  }

  private async queueSpikeTriggerOrder(params: {
    option: { symbol: string; token: number }
    decision: { strike?: number | null | undefined; stopLoss: number; riskRewardRatio?: number | undefined }
    lotSize?: number | undefined
    spotPrice: number
    entryPrice: number
    baseSignalPrice: number
    optionRiskPoints: number
    estimatedDelta: number
    tradeContext: TradeContext
  }): Promise<void> {
    const {
      option,
      decision,
      lotSize,
      spotPrice,
      entryPrice,
      baseSignalPrice,
      optionRiskPoints,
      estimatedDelta,
      tradeContext,
    } = params
    const slippagePct = ((entryPrice - baseSignalPrice) / baseSignalPrice) * 100
    console.log(
      `⚡ [UserSession] Spike Guard triggered for ${option.symbol}: CMP ₹${entryPrice.toFixed(2)} vs Base ₹${baseSignalPrice.toFixed(2)} (${slippagePct.toFixed(1)}% slippage). Queueing Pullback Trigger Order.`
    )

    const ttlMs = 15 * 60 * 1000
    const pendingOrder: PendingTriggerOrder = {
      id: `pending_${Math.random().toString(36).substr(2, 9)}`,
      symbol: option.symbol,
      token: option.token,
      strike: decision.strike || undefined,
      side: 'BUY',
      quantity: lotSize || 65,
      triggerPrice: baseSignalPrice,
      type: 'LIMIT',
      status: 'PENDING',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + ttlMs),
      ttlMs,
      indexInvalidation: decision.stopLoss,
      currentIndexPrice: spotPrice,
      optionRiskPoints,
      estimatedDelta,
      riskRewardRatio: decision.riskRewardRatio || 1.5,
      baseSignalPrice,
      context: {
        ...tradeContext,
        isTriggerOrder: true,
      },
    }

    await this.paperTrader.queuePendingOrder(pendingOrder)
  }

  private handleBreakoutError(err: any): void {
    console.error(`[UserSession] Error during breakout analysis:`, err)
    if (err?.message?.includes('Token is invalid') || err?.status === 403 || err?.status === 401) {
      console.error(`[UserSession] 🚨 Zerodha token expired or invalid for user ${this.userId}.`)
      this.tokenExpired = true
      this.emit('token_expired', { message: 'Zerodha token expired. Please re-login.' })
    }
  }

  // ── Ticker Listeners (session-level, includes tick routing) ─────────────
  private setupTickerListeners() {
    this.ticker.on('ticks', (ticks: any[]) => {
      // 1. Feed PaperTrader for SL/Target monitoring
      ticks.forEach((tick) => {
        this.paperTrader.updatePrice(tick.instrument_token, tick.last_price)
      })

      // 2. Feed global CandleBuilder and GTI Tracker (moved from ClientConnection)
      ticks.forEach((tick) => {
        candleBuilder.addTick(tick)
        gtiTracker.addTick(tick)
      })

      // 3. Feed LiveAnalyzer and PaperTrader index price monitor with watched symbol tick
      if (this.watchedToken) {
        const tick = ticks.find((t) => t.instrument_token === this.watchedToken)
        if (tick) {
          if (this.analyzer) {
            this.analyzer.addTick(tick)
          }
          if (this.watchedSymbol) {
            this.paperTrader.updateIndexPrice(this.watchedSymbol, tick.last_price)
          }
        }
      }

      // 4. Emit ticks for UI relay
      this.emit('ticks', ticks)
    })

    this.ticker.on('connect', () => {
      console.log(`[UserSession] Ticker connected for user ${this.userId}`)

      // Re-subscribe position tokens and pending order tokens
      const positionTokens = this.paperTrader.getAllPositions().map((p) => p.token)
      const pendingTokens = this.paperTrader.getPendingOrders().map((o) => o.token)
      const allTokens = Array.from(new Set([...positionTokens, ...pendingTokens]))
      if (allTokens.length > 0) {
        this.ticker.subscribe(allTokens)
        this.ticker.setMode(this.ticker.modeFull, allTokens)
      }

      // Re-subscribe watched token
      if (this.watchedToken) {
        this.ticker.subscribe([this.watchedToken])
        this.ticker.setMode(this.ticker.modeFull, [this.watchedToken])
      }

      this.emit('connect')
    })

    this.ticker.on('error', (err: any) => {
      console.error(`[UserSession] Ticker error for user ${this.userId}:`, err)
      this.emit('ticker_error', err)
    })

    this.ticker.on('close', (reason: any) => {
      console.warn(`[UserSession] Ticker closed for user ${this.userId}:`, reason)
      this.emit('ticker_close', reason)
    })

    // ── GTI: Listen to candle closes for watched token ─────────────────
    this.candleCloseHandler = async ({ token, timeframe, candle }) => {
      if (token !== this.watchedToken) return

      const gtiScore = gtiTracker.onCandleClose(token, candle)

      // Update LiveAnalyzer with fresh GTI score
      if (this.analyzer) {
        this.analyzer.updateGTI(gtiScore)
      }

      // Persist GTI score to DB
      try {
        await gtiRepo.saveScore({
          symbol: this.watchedSymbol || `TOKEN_${token}`,
          token,
          timeframe,
          candleTime: candle.timestamp,
          candle,
          gtiScore,
        })
      } catch (err) {
        console.error(`[UserSession] Failed to persist GTI score for ${this.watchedSymbol}:`, err)
      }
    }
    candleBuilder.on('candle_close', this.candleCloseHandler)
  }

  private cleanupTickerAndCandleListeners(): void {
    try {
      this.ticker.disconnect()
      if (typeof (this.ticker as any).removeAllListeners === 'function') {
        ;(this.ticker as any).removeAllListeners()
      }
    } catch (err) {
      console.warn(`[UserSession] Error during ticker disconnect for ${this.userId}:`, err)
    }

    if (this.candleCloseHandler) {
      candleBuilder.off('candle_close', this.candleCloseHandler)
      this.candleCloseHandler = null
    }
  }

  updateToken(accessToken: string, apiKey?: string) {
    if (this.accessToken === accessToken && this.apiKey === apiKey) return

    console.log(`[UserSession] Token refreshed for user ${this.userId}. Re-initializing client and ticker.`)
    this.accessToken = accessToken
    this.apiKey = apiKey
    this.tokenExpired = false

    this.kc = createKiteClient(accessToken, apiKey)
    this.paperTrader.setKiteClient(this.kc)

    this.cleanupTickerAndCandleListeners()

    this.ticker = createTicker(accessToken, apiKey)
    this.setupTickerListeners()
    this.ticker.connect()

    this.emit('ticker_recreated')
  }

  destroy() {
    this.analyzer.off('breakout', this.onBreakout)
    this.cleanupTickerAndCandleListeners()
    this.paperTrader.removeAllListeners()
    this.removeAllListeners()
  }
}

class SessionManager {
  private sessions = new Map<string, UserSession>()

  async getSession(
    userId: string,
    accessToken: string,
    apiKey: string,
    tradeMode: 'PAPER' | 'REAL' = 'PAPER'
  ): Promise<UserSession> {
    if (this.sessions.has(userId)) {
      const session = this.sessions.get(userId)!
      session.paperTrader.setTradeMode(tradeMode)
      session.updateToken(accessToken, apiKey)
      return session
    }

    const session = new UserSession(userId, accessToken, apiKey, tradeMode)
    await session.initialize()
    this.sessions.set(userId, session)
    return session
  }

  removeSession(userId: string) {
    const session = this.sessions.get(userId)
    if (session) {
      session.destroy()
      this.sessions.delete(userId)
    }
  }

  getExistingSession(userId: string): UserSession | undefined {
    return this.sessions.get(userId)
  }

  getAllSessions(): UserSession[] {
    return Array.from(this.sessions.values())
  }
}

export const sessionManager = new SessionManager()
