import { EventEmitter } from 'node:events'
import { PaperTrader } from './paper-trader.js'
import { createTicker } from '../data/kite-ticker.js'
import { createKiteClient, getInstrumentToken, getOptionToken } from '../data/kite.js'
import { LiveAnalyzer, type AnalysisLevels } from '../analysis/live.js'
import { candleBuilder } from '../data/candle-builder.js'
import { gtiTracker } from '../indicators/gti-tracker.js'
import { runAnalysis } from '../analysis/trade.js'
import { eventRepo, gtiRepo, userRepo, scannerAlertRepo, analysisSnapshotRepo } from '../db/repositories/container.js'
import { isClosingBellFilterActive, isMarketOpen, isOpeningBellFilterActive } from '../utils/market-hours.js'
import type { Connect as KiteConnect } from 'kiteconnect'
import type { AIMacroTrend, TradingAgentType } from '../ai/types.js'
import { getCalendarDaysToExpiry, getExpiryRiskProfile } from './expiry-risk-profile.js'
import type { PendingTriggerOrder, TradeContext } from './types.js'
import { globalKiteScanner } from '../data/kite-scanner.js'
import { equityAnalysisService } from '../analysis/equity-analysis.js'
import { getFnoLotSize } from '../data/instrument-classifier.js'
import { universeBootstrapper } from '../data/universe-bootstrapper.js'
import { analysisQueue } from './analysis-queue.js'
import { createLogger } from '../utils/logger.js'

const logger = createLogger('SessionManager')

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
  private screenerInterval: NodeJS.Timeout | null = null

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
    await universeBootstrapper.bootstrapScannerUniverse(this.kc)
    this.ticker.connect()
    await this.autoWatch()
  }

  // ── Watch: Configure session-level analysis for a symbol ────────────────
  async watch(symbol: string, levels?: AnalysisLevels, mode?: 'intraday' | 'swing') {
    const upperSymbol = symbol.toUpperCase().trim()
    const token = await getInstrumentToken(this.kc, upperSymbol)

    if (!token) {
      logger.error(`[UserSession] Token not found for ${upperSymbol}`)
      this.emit('watch_error', { message: `Token not found for ${upperSymbol}` })
      return
    }

    await candleBuilder.seedFromKite(this.kc, token)

    // Pinning Guard: If NIFTY/BANKNIFTY is actively watched as the autonomous index engine,
    // clicking a stock in the UI subscribes its ticks for chart display without unhooking NIFTY.
    const isCurrentIndex = this.watchedSymbol === 'NIFTY' || this.watchedSymbol === 'BANKNIFTY'
    const isRequestedIndex = upperSymbol === 'NIFTY' || upperSymbol === 'BANKNIFTY'
    if (isCurrentIndex && !isRequestedIndex && this.watchedToken) {
      this.ticker.subscribe([token])
      this.ticker.setMode(this.ticker.modeFull, [token])
      this.emit('watching', { symbol: upperSymbol, token })
      return
    }

    // Idempotent Reconnect Guard: If already watching this exact symbol, preserve LiveAnalyzer
    // cooldowns and dynamic levels instead of resetting on browser wakeup/reconnect.
    if (this.watchedSymbol === upperSymbol && this.watchedToken === token) {
      if (levels && !this.analyzer.hasLevels()) {
        this.analyzer.setLevels(levels)
      }
      this.subscribeActiveTokens(token)
      this.emit('watching', { symbol: upperSymbol, token })
      this.emit('portfolio_sync', this.paperTrader.getAllPositions())
      return
    }

    // Cleanup previous analyzer listeners
    this.analyzer.off('breakout', this.onBreakout)

    const prevAnalysisPrice = this.analyzer?.getLastAnalysisPrice() || 0

    // Reset analyzer with fresh state for newly watched index symbol
    this.analyzer = new LiveAnalyzer()
    if (prevAnalysisPrice > 0) {
      this.analyzer.setLastAnalysisPrice(prevAnalysisPrice)
    }
    this.watchedSymbol = upperSymbol
    this.watchedToken = token
    this.watchMode = mode || 'intraday'

    if (!isMarketOpen()) {
      logger.info(`[UserSession] Market is closed. Watch registered for ${upperSymbol} in read-only mode.`)
      this.emit('market_closed', { message: 'Market is closed. Operating in read-only mode.' })
    } else {
      if (levels) {
        this.analyzer.setLevels(levels)
      }
      this.analyzer.on('breakout', this.onBreakout)
      logger.info(`[UserSession] 🔭 Watching ${upperSymbol} (token: ${token}, mode: ${this.watchMode})`)
    }

    this.subscribeActiveTokens(token)

    // Persist watch config to DB
    try {
      await userRepo.updateWatchConfig(this.userId, upperSymbol, this.watchMode)
    } catch (err) {
      logger.error(`[UserSession] Failed to persist watch config for ${upperSymbol}:`, err)
    }

    this.emit('watching', { symbol: upperSymbol, token })
    this.emit('portfolio_sync', this.paperTrader.getAllPositions())
  }

  private subscribeActiveTokens(primaryToken: number): void {
    const positionTokens = this.paperTrader
      .getAllPositions()
      .map((p) => p.token)
      .filter((t) => !!t)
    const pendingTokens = this.paperTrader
      .getPendingOrders()
      .map((o) => o.token)
      .filter((t) => !!t)
    const tokensToSubscribe = Array.from(new Set([primaryToken, ...positionTokens, ...pendingTokens]))

    this.ticker.subscribe(tokensToSubscribe)
    this.ticker.setMode(this.ticker.modeFull, tokensToSubscribe)
  }

  async autoWatch() {
    try {
      const profile = await userRepo.getUserProfileByUserId(this.userId)
      if (profile) {
        this.paperTrader.configurePool(profile)
      }

      const allowsIndex = (profile?.allowedUniverses ?? 'INDEX_OPTIONS,EQUITY,STOCK_OPTIONS').includes('INDEX_OPTIONS')
      const targetSymbol = profile?.watchedSymbol || (allowsIndex ? 'NIFTY' : null)

      if (targetSymbol && isMarketOpen()) {
        logger.info(`[UserSession] Auto-watching ${targetSymbol} on initialization...`)
        await this.watch(targetSymbol, undefined, (profile?.watchedMode as 'intraday' | 'swing') || 'intraday')
      }
    } catch (err) {
      logger.error(`[UserSession] Failed to auto-watch on initialization:`, err)
    }
  }

  // ── Breakout Handler (session-level, autonomous) ────────────────────────
  private onBreakout = async (context: any) => {
    if (this.tokenExpired) {
      logger.info(`[UserSession] Token is expired. Aborting breakout analysis for ${this.watchedSymbol}.`)
      return
    }

    if (isOpeningBellFilterActive()) {
      logger.info(`[UserSession] Opening bell filter active (09:15–09:30 IST). Skipping breakout for ${this.watchedSymbol}.`)
      return
    }

    if (isClosingBellFilterActive()) {
      logger.info(`[UserSession] Closing bell filter active (15:15–15:30 IST). Skipping breakout for ${this.watchedSymbol}.`)
      return
    }

    if (this.isAnalyzing) {
      logger.info(
        `[UserSession] AI is already analyzing for ${this.watchedSymbol}. Dropping concurrent breakout event.`
      )
      return
    }
    this.isAnalyzing = true

    try {
      logger.info(`[UserSession] 🔥 Breakout detected for ${this.watchedSymbol}: ${context.reason}`)
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

      try {
        const tradingDate = new Date().toISOString().split('T')[0]!
        await analysisSnapshotRepo.saveSnapshot({
          userId: this.userId,
          symbol: this.watchedSymbol,
          timeframe: '15m',
          support: analysisResult.tf15m?.support,
          resistance: analysisResult.tf15m?.resistance,
          vwap: analysisResult.tf15m?.vwap,
          atr: analysisResult.tf15m?.atr14,
          levels: {
            support: analysisResult.tf15m?.support,
            resistance: analysisResult.tf15m?.resistance,
            vwap: analysisResult.tf15m?.vwap,
            orb: analysisResult.tf15m?.openingRange,
            daily: analysisResult.dailyContext,
          },
          decision: analysisResult.aiDecision,
          agentDeliberations: {
            agentType: analysisResult.agentType,
            vix: analysisResult.vix,
            sentiment: analysisResult.sentiment,
            macroTrend: analysisResult.tf1h?.trend || analysisResult.aiDecision?.macroTrend || 'NEUTRAL',
          },
          tradingDate,
        })
      } catch (snapErr) {
        logger.warn(`[UserSession] Failed to persist snapshot for ${this.watchedSymbol}:`, snapErr)
      }

      // Dynamically update analyzer levels and last analysis price
      if (this.analyzer) {
        if (analysisResult?.tf15m) {
          this.analyzer.setLevels({
            resistance: analysisResult.tf15m.resistance,
            support: analysisResult.tf15m.support,
            vwap: analysisResult.tf15m.vwap,
          })
        }
        if (context?.tick?.last_price) {
          this.analyzer.setLastAnalysisPrice(context.tick.last_price)
        }
      }

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

    logger.info(`[UserSession] Executing Paper Trade for ${option.symbol} (${agentType} Agent)...`)
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
      logger.warn(
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
    logger.info(
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
    logger.error(`[UserSession] Error during breakout analysis:`, err)
    if (err?.message?.includes('Token is invalid') || err?.status === 403 || err?.status === 401) {
      logger.error(`[UserSession] 🚨 Zerodha token expired or invalid for user ${this.userId}.`)
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

      // 2. Feed global CandleBuilder, GTI Tracker, and KiteScanner
      ticks.forEach((tick) => {
        candleBuilder.addTick(tick)
        gtiTracker.addTick(tick)
        globalKiteScanner.processTick(tick)
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
      logger.info(`[UserSession] Ticker connected for user ${this.userId}`)

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

      // Subscribe screener tokens in modeQuote (lightweight multi-asset stream)
      const screenerTokens = globalKiteScanner.getTokens()
      if (screenerTokens.length > 0) {
        for (let i = 0; i < screenerTokens.length; i += 100) {
          const chunk = screenerTokens.slice(i, i + 100)
          this.ticker.subscribe(chunk)
          this.ticker.setMode(this.ticker.modeQuote, chunk)
        }
      }

      this.emit('connect')
    })

    // Throttled UI screener snapshot updates (every 1.5s)
    if (this.screenerInterval) clearInterval(this.screenerInterval)
    this.screenerInterval = setInterval(() => {
      this.emit('screener_update', globalKiteScanner.getScreenerSnapshot())
    }, 1500)

    // Listen to autonomous candidate alerts from KiteScanner
    globalKiteScanner.on('candidate_surfaced', this.onCandidateSurfaced)

    this.ticker.on('error', (err: any) => {
      logger.error(`[UserSession] Ticker error for user ${this.userId}:`, err)
      this.emit('ticker_error', err)
    })

    this.ticker.on('close', (reason: any) => {
      logger.warn(`[UserSession] Ticker closed for user ${this.userId}:`, reason)
      this.emit('ticker_close', reason)
    })

    // ── GTI: Listen to candle closes for watched token ─────────────────
    this.candleCloseHandler = async ({ token, timeframe, candle }) => {
      if (token !== this.watchedToken) return

      const gtiScore = gtiTracker.onCandleClose(token, candle)

      // Update LiveAnalyzer with fresh GTI score and structural candle events
      if (this.analyzer) {
        this.analyzer.updateGTI(gtiScore)
        if (timeframe === 5) {
          const recentCandles = candleBuilder.getCandles(token, timeframe).slice(-6)
          this.analyzer.checkCandleClose(candle, timeframe, recentCandles)
        }
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
        logger.error(`[UserSession] Failed to persist GTI score for ${this.watchedSymbol}:`, err)
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
      logger.warn(`[UserSession] Error during ticker disconnect for ${this.userId}:`, err)
    }

    if (this.candleCloseHandler) {
      candleBuilder.off('candle_close', this.candleCloseHandler)
      this.candleCloseHandler = null
    }

    if (this.screenerInterval) {
      clearInterval(this.screenerInterval)
      this.screenerInterval = null
    }
    globalKiteScanner.off('candidate_surfaced', this.onCandidateSurfaced)
  }

  private onCandidateSurfaced = async (candidate: any) => {
    if (this.tokenExpired || !isMarketOpen() || isOpeningBellFilterActive() || isClosingBellFilterActive()) return

    try {
      const profile = await userRepo.getUserProfileByUserId(this.userId)
      if (profile) {
        this.paperTrader.configurePool(profile)
      }

      const allowedUniverses = profile?.allowedUniverses || 'INDEX_OPTIONS,EQUITY,STOCK_OPTIONS'
      const allowsEquity = allowedUniverses.includes('EQUITY')
      const allowsStockOptions = allowedUniverses.includes('STOCK_OPTIONS')
      if (!allowsEquity && !allowsStockOptions) return

      const tradingDate = new Date().toISOString().split('T')[0]!
      const alertId = await scannerAlertRepo.saveAlert({
        symbol: candidate.symbol,
        token: candidate.token,
        price: candidate.price,
        atp: candidate.atp,
        volumeSurgeRatio: candidate.volumeSurgeRatio,
        changePct: candidate.changePct,
        obi: candidate.obi,
        priorityScore: candidate.priorityScore,
        status: 'PENDING',
        tradingDate,
        metadata: { isFnoListed: candidate.isFnoListed, direction: candidate.direction },
      })
      candidate.id = alertId

      this.emit('candidate_alert', candidate)

      analysisQueue.enqueue(candidate, this.userId, async (cand, uId) => {
        try {
          const result = await equityAnalysisService.analyzeCandidate(this.kc, cand.symbol, {
            stockOptionPreference: profile?.stockOptionPreference || 'PREFER_OPTIONS_IF_LISTED',
            equityHoldingMode: (profile?.equityHoldingMode as 'MIS' | 'CNC') || 'MIS',
            equityRiskPerTrade: Number(profile?.equityRiskPerTrade) || 1500,
          })

          const isDirectionalDecision =
            result.decision.decision === 'BUY' || result.decision.decision === 'SELL'
          const isTraded = isDirectionalDecision && result.decision.action !== 'NONE'

          await scannerAlertRepo.updateStatus(cand.id, isTraded ? 'TRADED' : 'ANALYZED', {
            decision: result.decision,
            assetClass: result.assetClass,
          })

          await analysisSnapshotRepo.saveSnapshot({
            userId: uId,
            symbol: cand.symbol,
            timeframe: '15m',
            support: result.context?.tf15m.support ?? null,
            resistance: result.context?.tf15m.resistance ?? null,
            vwap: result.context?.tf15m.vwap ?? null,
            atr: result.context?.tf5m.atr14 ?? null,
            levels: {
              entry: result.decision.entryPrice,
              stopLoss: result.decision.stopLoss,
              targets: result.decision.targets,
              support: result.context?.tf15m.support,
              resistance: result.context?.tf15m.resistance,
              vwap: result.context?.tf15m.vwap,
            },
            decision: result.decision,
            agentDeliberations: {
              assetClass: result.assetClass,
              confidence: result.decision.confidence,
              reason: result.decision.reason,
              vix: result.vix,
              rsi: result.context?.tf15m.rsi,
              trend15m: result.context?.tf15m.trend,
            },
            tradingDate,
          })

          if (!isTraded) return

          const telemetry = {
            context: result.context,
            vix: result.vix,
            usePullbackQueue:
              profile?.enablePullbackEntry === true || process.env.ENABLE_WAVE_PULLBACK_ENTRY === 'true',
          }

          if (result.assetClass === 'EQUITY' && allowsEquity) {
            await this.executeSurfacedEquityOrder(cand, result.decision, telemetry)
          } else if (result.assetClass === 'STOCK_OPTION' && allowsStockOptions && result.optionDetails) {
            await this.executeSurfacedOptionOrder(result.optionDetails, result.decision, cand, telemetry)
          }
        } catch (evalErr: any) {
          logger.error(`[UserSession] Failed analysis for candidate ${cand.symbol}:`, evalErr.message || evalErr)
          await scannerAlertRepo.updateStatus(cand.id, 'EXPIRED', { error: evalErr.message })
        }
      })
    } catch (err: any) {
      logger.error(`[UserSession] Error handling candidate ${candidate.symbol}:`, err.message || err)
    }
  }

  /**
   * Executes a surfaced Cash Equity trade (supporting both Long BUY and Intraday MIS Short SELL).
   * Populates full VIX, RSI, and 15m Trend telemetry, and optionally queues a Wave Pullback Limit Order
   * slightly below the impulse spike top to improve entry price and avoid bull/bear traps.
   */
  private async executeSurfacedEquityOrder(
    candidate: any,
    decision: any,
    telemetry?: { context?: any; vix?: any; usePullbackQueue?: boolean }
  ): Promise<void> {
    const isShort = decision.action === 'SELL_EQUITY' || decision.decision === 'SELL'
    if (isShort && decision.holdingMode === 'CNC') {
      logger.warn(`[UserSession] Skipping short equity trade for ${candidate.symbol}: SEBI prohibits CNC overnight shorting.`)
      return
    }

    const side = isShort ? 'SELL' : 'BUY'
    logger.info(`[UserSession] Executing Equity ${side} Trade for ${candidate.symbol} (${decision.holdingMode})...`)
    const livePrice = candidate.price && candidate.price > 0 ? candidate.price : decision.entryPrice
    const entryPrice = Math.abs(decision.entryPrice - livePrice) / livePrice > 0.02 ? livePrice : decision.entryPrice

    this.ticker.subscribe([candidate.token])
    this.ticker.setMode(this.ticker.modeFull, [candidate.token])

    const tradeContext: TradeContext = {
      assetClass: 'EQUITY',
      product: decision.holdingMode,
      isShortEntry: isShort,
      aiReasoning: decision.reason,
      aiConfidence: decision.confidence,
      aiSetup: decision.action,
      vixLevel: telemetry?.vix?.current,
      rsiLevel: telemetry?.context?.tf15m?.rsi,
      trend15m: telemetry?.context?.tf15m?.trend,
      aiStopLoss: decision.stopLoss,
      aiTarget: decision.targets[0],
      aiIndexTargets: decision.targets,
    }

    if (telemetry?.usePullbackQueue) {
      await this.queueEquityWavePullbackOrder(candidate, side, entryPrice, decision, tradeContext)
      return
    }

    await this.paperTrader.placeOrder({
      symbol: candidate.symbol,
      token: candidate.token,
      side,
      quantity: 1,
      price: entryPrice,
      context: tradeContext,
    })
  }

  /**
   * Queues a Wave Pullback Limit Trigger Order for an equity candidate (-0.25% below spike for Long,
   * +0.25% above breakdown for Short) with structural stop-loss invalidation protection.
   */
  private async queueEquityWavePullbackOrder(
    candidate: any,
    side: 'BUY' | 'SELL',
    entryPrice: number,
    decision: any,
    tradeContext: TradeContext
  ): Promise<void> {
    const pullbackPct = Number(process.env.EQUITY_WAVE_PULLBACK_PCT || 0.0025)
    const triggerPrice =
      side === 'SELL'
        ? Number((entryPrice * (1 + pullbackPct)).toFixed(2))
        : Number((entryPrice * (1 - pullbackPct)).toFixed(2))
    const ttlMs = 15 * 60 * 1000

    await this.paperTrader.queuePendingOrder({
      id: `pending_${Math.random().toString(36).substr(2, 9)}`,
      symbol: candidate.symbol,
      token: candidate.token,
      side,
      quantity: 1,
      triggerPrice,
      type: 'LIMIT',
      status: 'PENDING',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + ttlMs),
      ttlMs,
      indexInvalidation: decision.stopLoss,
      currentIndexPrice: entryPrice,
      riskRewardRatio: decision.riskRewardRatio || 1.5,
      baseSignalPrice: triggerPrice,
      context: {
        ...tradeContext,
        triggerPrice,
        isTriggerOrder: true,
      },
    })
  }

  private resolveSurfacedOptionPrice(quote: any): number {
    const hasTradedToday = (quote?.volume ?? 0) > 0 && (quote?.ohlc?.open ?? 0) > 0
    const bestAsk = quote?.depth?.sell?.[0]?.price ?? 0
    if (hasTradedToday && quote?.last_price > 0) return quote.last_price
    return bestAsk > 0 ? bestAsk : 0
  }

  private isOptionLiquiditySufficient(quote: any): boolean {
    const bestAsk = quote?.depth?.sell?.[0]?.price ?? 0
    const bestBid = quote?.depth?.buy?.[0]?.price ?? 0
    if (bestAsk <= 0 || bestBid <= 0) return true
    const spreadPct = ((bestAsk - bestBid) / bestAsk) * 100
    return spreadPct <= 12
  }

  private async executeSurfacedOptionOrder(
    option: { symbol: string; token: number; expiry?: Date; lotSize?: number },
    decision: any,
    candidate?: any,
    telemetry?: { context?: any; vix?: any; usePullbackQueue?: boolean }
  ): Promise<void> {
    logger.info(`[UserSession] Validating & Executing Stock Option Trade for ${option.symbol}...`)
    const quoteMap = await this.kc.getQuote([`NFO:${option.symbol}`])
    const quote = quoteMap[`NFO:${option.symbol}`]
    const entryPrice = this.resolveSurfacedOptionPrice(quote)

    if (entryPrice <= 0 || !this.isOptionLiquiditySufficient(quote)) {
      logger.warn(`[UserSession] Option ${option.symbol} skipped: stale/untraded quote or wide spread.`)
      return
    }

    const lotSize = option.lotSize || (await getFnoLotSize(this.kc, option.symbol)) || 1
    const maxOptionRisk = Number(process.env.MAX_OPTION_RISK_PER_TRADE || 2000)
    const optionRiskPct = Number(process.env.STOCK_OPTION_RISK_PCT || 0.20)
    const estimatedRisk = lotSize * entryPrice * optionRiskPct

    if (estimatedRisk > maxOptionRisk && candidate) {
      logger.info(
        `⚖️ [UserSession] Option ${option.symbol} 1-lot risk (₹${estimatedRisk.toFixed(2)}) exceeds max risk cap (₹${maxOptionRisk}). Routing to Cash Equity.`
      )
      await this.executeSurfacedEquityOrder(candidate, decision, telemetry)
      return
    }

    this.ticker.subscribe([option.token])
    this.ticker.setMode(this.ticker.modeFull, [option.token])

    const tradeContext: TradeContext = {
      assetClass: 'STOCK_OPTION',
      product: 'MIS',
      lotSize,
      optionExpiry: option.expiry,
      aiReasoning: decision.reason,
      aiConfidence: decision.confidence,
      aiSetup: decision.action,
      vixLevel: telemetry?.vix?.current,
      rsiLevel: telemetry?.context?.tf15m?.rsi,
      trend15m: telemetry?.context?.tf15m?.trend,
      aiStrike: decision.strike || undefined,
      aiStopLoss: Number((entryPrice * (1 - optionRiskPct)).toFixed(2)),
      aiTarget: Number((entryPrice * 1.35).toFixed(2)),
    }

    if (telemetry?.usePullbackQueue) {
      await this.queueStockOptionWavePullbackOrder(option, decision, entryPrice, lotSize, tradeContext)
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

  /**
   * Queues a Wave Pullback Limit Trigger Order for a Stock Option (-3% discount below the spike ask)
   * so the system buys the retracement dip rather than chasing inflated option premiums.
   */
  private async queueStockOptionWavePullbackOrder(
    option: { symbol: string; token: number; expiry?: Date; lotSize?: number },
    decision: any,
    entryPrice: number,
    lotSize: number,
    tradeContext: TradeContext
  ): Promise<void> {
    const pullbackPct = Number(process.env.STOCK_OPTION_PULLBACK_PCT || 0.03)
    const triggerPrice = Math.max(0.05, Number((entryPrice * (1 - pullbackPct)).toFixed(2)))
    const ttlMs = 15 * 60 * 1000

    await this.paperTrader.queuePendingOrder({
      id: `pending_${Math.random().toString(36).substr(2, 9)}`,
      symbol: option.symbol,
      token: option.token,
      strike: decision.strike || undefined,
      side: 'BUY',
      quantity: lotSize,
      triggerPrice,
      type: 'LIMIT',
      status: 'PENDING',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + ttlMs),
      ttlMs,
      indexInvalidation: decision.stopLoss,
      currentIndexPrice: decision.entryPrice,
      riskRewardRatio: decision.riskRewardRatio || 1.5,
      baseSignalPrice: triggerPrice,
      context: {
        ...tradeContext,
        triggerPrice,
        isTriggerOrder: true,
      },
    })
  }

  updateToken(accessToken: string, apiKey?: string) {
    if (this.accessToken === accessToken && this.apiKey === apiKey) return

    logger.info(`[UserSession] Token refreshed for user ${this.userId}. Re-initializing client and ticker.`)
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
