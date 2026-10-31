import { getMultiTimeframeCandles } from '../data/yahoo.js'
import { analyzeMultiTimeframe, analyzeDailyContext } from './technical.js'
import { LLMService } from '../ai/llm.js'
import { validateRegime, type ValidationResult } from '../ai/regime-validator.js'
import { getNews } from '../data/news.js'
import { analyzeSentiment } from './sentiment.js'
import { getOptionChain } from '../data/kite-options.js'
import { analyzeOptions } from './kite-options.js'
import { getIndiaVix } from '../data/vix.js'
import { getYesterdayClosingOI } from '../data/kite-historical.js'
import type { PaperPosition } from '../execution/types.js'
import type { MarketContext, TradingAgentType } from '../ai/types.js'
import { cooldownManager } from '../utils/cooldown.js'
import type { Candle, TradeTechnicalAnalysis } from '../types/analysis.js'
import { getInstrumentToken } from '../data/kite.js'
import { gtiTracker } from '../indicators/gti-tracker.js'
import { resolveYahooTicker } from '../utils/symbol.js'
import { calculateReversalScore } from './reversals.js'

const divider = '═'.repeat(50)

function logSection(title: string): void {
  console.log(`\n${divider}`)
  console.log(title)
  console.log(`${divider}\n`)
}

// Cache for baseline data
let yesterdayOiCache: Map<number, number> | undefined = undefined
let lastCacheSymbol: string | null = null

export class TradeAnalysisService {
  constructor(private readonly llmService: LLMService = new LLMService()) {}

  public async runAnalysis(
    kc: any,
    symbol: string,
    mode: 'intraday' | 'swing' = 'intraday',
    liveContext?: any,
    previousDecision?: any,
    injectedCandles?: {
      candles1d: Candle[]
      candles1h: Candle[]
      candles30m?: Candle[]
      candles15m: Candle[]
      candles3m: Candle[]
    },
    userId: string = ''
  ): Promise<TradeTechnicalAnalysis> {
    resolveYahooTicker(symbol)

    const [candles, headlines, vix, kiteData] = await this.fetchAnalysisInputs(kc, symbol, injectedCandles)

    if (candles.candles15m.length === 0) {
      throw new Error('No 15-minute candles found.')
    }

    const { tf1h, tf30m, tf15m, tf3m } = analyzeMultiTimeframe(
      candles.candles1h,
      candles.candles30m || [],
      candles.candles15m,
      candles.candles3m
    )
    const dailyContext = analyzeDailyContext(candles.candles1d, candles.candles15m)
    const { quotes, finalOptions, lotSize } = kiteData

    const optionsAnalysisZerodha = await this.buildEnrichedOptionsAnalysis(
      kc,
      symbol,
      quotes,
      finalOptions,
      tf15m.price
    )

    if (cooldownManager.isOnCooldown(symbol) || vix.current > 25) {
      const reason = cooldownManager.isOnCooldown(symbol) ? 'Symbol on Cooldown' : 'VIX > 25 Circuit Breaker'
      console.log(`[Circuit Breaker] Aborting analysis for ${symbol}: ${reason}`)
      return this.buildNoTradeResult({
        tf1h,
        tf30m,
        tf15m,
        tf3m,
        dailyContext,
        vix,
        sentiment: { sentiment: 'neutral', confidence: 1, reason: 'Skipped due to circuit breaker' },
        optionsAnalysis: optionsAnalysisZerodha,
        candles,
        agentType: 'SCALPER',
        reason,
        macroTrend: 'SIDEWAYS',
      })
    }

    const sentiment = await analyzeSentiment(headlines)
    const underlyingToken = await getInstrumentToken(kc, symbol)
    const effectiveToken = underlyingToken || 1
    const effectiveAtr15m = tf15m.atr14 || dailyContext?.atr14 || 20
    const gtiScore = gtiTracker.computeFromCandles(effectiveToken, candles.candles15m, tf15m.vwap, effectiveAtr15m, {
      sentiment: optionsAnalysisZerodha.sentiment,
      marketFlow: optionsAnalysisZerodha.marketFlow,
      pcr: optionsAnalysisZerodha.pcr,
    })
    tf15m.gtiScore = gtiScore
    tf3m.gtiScore = gtiScore

    const marketContext: MarketContext = {
      tf1h,
      tf30m,
      tf15m,
      tf3m,
      dailyContext,
      optionsAnalysisZerodha,
      vix,
      mode,
      time: new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false }),
      ...(gtiScore && gtiScore.confidence > 0 ? { gtiScore } : {}),
    }

    const activeAgent = await this.resolveActiveAgent(marketContext, userId)
    const reversalScore = this.computeReversalScores({
      tf1h,
      tf30m,
      tf15m,
      tf3m,
      dailyContext,
      vix,
      sentiment,
      optionsAnalysis: optionsAnalysisZerodha,
      candles,
      agentType: activeAgent,
    })

    const aiDecision = await this.llmService.analyzeWithEnsemble(
      {
        tf1h,
        tf30m,
        tf15m,
        tf3m,
        dailyContext,
        sentiment,
        optionsAnalysisZerodha,
        vix,
        mode,
        liveContext,
        previousDecision,
        reversalScore,
        symbol,
      },
      activeAgent,
      userId
    )

    if (!aiDecision) {
      return {
        ...this.buildNoTradeResult({
          tf1h,
          tf30m,
          tf15m,
          tf3m,
          dailyContext,
          vix,
          sentiment,
          optionsAnalysis: optionsAnalysisZerodha,
          candles,
          agentType: activeAgent || 'SCALPER',
          reason: 'No active trend + high VIX structure requires sitting out.',
          macroTrend: mode,
        }),
        gtiHistory: gtiTracker.getHistory(0),
      }
    }

    this.processAiDecisionFilters(aiDecision, tf15m, gtiScore, activeAgent, reversalScore)
    this.logAnalysisSummary(liveContext, vix, sentiment, aiDecision, tf15m, tf1h, dailyContext, gtiScore)

    return {
      tf1h,
      tf30m,
      tf15m,
      tf3m,
      dailyContext,
      aiDecision,
      vix,
      sentiment,
      optionsAnalysis: optionsAnalysisZerodha,
      candles1h: candles.candles1h.slice(-100),
      candles30m: candles.candles30m ? candles.candles30m.slice(-100) : [],
      candles15m: candles.candles15m.slice(-100),
      candles3m: candles.candles3m.slice(-100),
      agentType: (activeAgent || 'SCALPER') as TradingAgentType,
      gtiHistory: gtiTracker.getHistory(0),
      lotSize: lotSize || 1,
      reversalScore,
    }
  }

  private async buildEnrichedOptionsAnalysis(
    kc: any,
    symbol: string,
    quotes: Record<string, any>,
    finalOptions: any[],
    spotPrice: number
  ) {
    if (!yesterdayOiCache || lastCacheSymbol !== symbol) {
      const tokens = finalOptions.map((opt: any) => opt.instrument_token).filter((t: any): t is number => !!t)
      yesterdayOiCache = await getYesterdayClosingOI(kc, tokens)
      lastCacheSymbol = symbol
    }

    const intervalMins = Number(process.env.OI_SHIFT_INTERVAL_MINS || 5)
    const optionsAnalysisZerodha = analyzeOptions(quotes, finalOptions, spotPrice, yesterdayOiCache, intervalMins)

    const atmRow = optionsAnalysisZerodha.rows.find(
      (r) => r.strike === optionsAnalysisZerodha.atmStrike && r.type === 'CE'
    )
    const currentIv = atmRow?.greeks?.iv || 0.15
    const ivStats = await this.resolveIvStatsSafely(symbol, currentIv)
    optionsAnalysisZerodha.ivRank = ivStats.ivRank
    optionsAnalysisZerodha.ivPercentile = ivStats.ivPercentile

    const atmIdx = optionsAnalysisZerodha.rows.findIndex(
      (r) => r.strike === optionsAnalysisZerodha.atmStrike && r.type === 'CE'
    )
    if (atmIdx !== -1) {
      const startIdx = Math.max(0, atmIdx - 4)
      const endIdx = Math.min(optionsAnalysisZerodha.rows.length, atmIdx + 6)
      optionsAnalysisZerodha.rows = optionsAnalysisZerodha.rows.slice(startIdx, endIdx)
    }

    return optionsAnalysisZerodha
  }

  private async resolveIvStatsSafely(
    symbol: string,
    currentIv: number
  ): Promise<{ ivRank: number; ivPercentile: number }> {
    try {
      const { ivHistoryRepo } = await import('../db/repositories/iv-history.js')
      return await ivHistoryRepo.getIvStats(symbol, currentIv, 30)
    } catch {
      return { ivRank: 0, ivPercentile: 0 }
    }
  }

  private buildNoTradeResult(params: {
    tf1h: TradeTechnicalAnalysis['tf1h']
    tf30m: TradeTechnicalAnalysis['tf30m']
    tf15m: TradeTechnicalAnalysis['tf15m']
    tf3m: TradeTechnicalAnalysis['tf3m']
    dailyContext: TradeTechnicalAnalysis['dailyContext']
    vix: TradeTechnicalAnalysis['vix']
    sentiment: TradeTechnicalAnalysis['sentiment']
    optionsAnalysis: TradeTechnicalAnalysis['optionsAnalysis']
    candles: {
      candles1h: Candle[]
      candles30m?: Candle[] | undefined
      candles15m: Candle[]
      candles3m: Candle[]
    }
    agentType: TradingAgentType
    reason: string
    macroTrend: string
  }): TradeTechnicalAnalysis {
    const {
      tf1h,
      tf30m,
      tf15m,
      tf3m,
      dailyContext,
      vix,
      sentiment,
      optionsAnalysis,
      candles,
      agentType,
      reason,
      macroTrend,
    } = params
    return {
      tf1h,
      tf30m,
      tf15m,
      tf3m,
      dailyContext,
      vix,
      sentiment,
      optionsAnalysis,
      candles1h: candles.candles1h.slice(-100),
      candles30m: candles.candles30m ? candles.candles30m.slice(-100) : [],
      candles15m: candles.candles15m.slice(-100),
      candles3m: candles.candles3m.slice(-100),
      agentType,
      aiDecision: {
        decision: 'NO_TRADE',
        reason,
        confidence: 100,
        optionAction: 'NONE',
        setup: 'NONE',
        riskRewardRatio: 0,
        entry: 0,
        stopLoss: 0,
        targets: [],
        instrument: 'OPTIONS',
        strike: null,
        macroTrend: macroTrend as any,
      },
    }
  }

  private async resolveActiveAgent(marketContext: MarketContext, userId: string): Promise<TradingAgentType> {
    const orchestrator = await this.llmService.evaluateMarketState(marketContext, userId)
    const validation = validateRegime(orchestrator, marketContext)
    if (validation.wasOverridden) {
      this.logRegimeOverride(orchestrator.activeAgent, validation)
    } else {
      console.log(`[Orchestrator] Active Agent: ${validation.activeAgent} (${orchestrator.confidence}%)`)
      console.log(`[Orchestrator] Rationale: ${orchestrator.rationale}`)
    }
    return validation.activeAgent as TradingAgentType
  }

  private computeReversalScores(params: {
    tf1h: TradeTechnicalAnalysis['tf1h']
    tf30m: TradeTechnicalAnalysis['tf30m']
    tf15m: TradeTechnicalAnalysis['tf15m']
    tf3m: TradeTechnicalAnalysis['tf3m']
    dailyContext: TradeTechnicalAnalysis['dailyContext']
    vix: TradeTechnicalAnalysis['vix']
    sentiment: TradeTechnicalAnalysis['sentiment']
    optionsAnalysis: TradeTechnicalAnalysis['optionsAnalysis']
    candles: { candles1h: Candle[]; candles15m: Candle[]; candles3m: Candle[] }
    agentType: TradingAgentType
  }): { bullish: number; bearish: number } {
    const tempAnalysisForScore = {
      tf1h: params.tf1h,
      tf30m: params.tf30m,
      tf15m: params.tf15m,
      tf3m: params.tf3m,
      dailyContext: params.dailyContext,
      vix: params.vix,
      sentiment: params.sentiment,
      optionsAnalysis: params.optionsAnalysis,
      candles1h: params.candles.candles1h,
      candles15m: params.candles.candles15m,
      candles3m: params.candles.candles3m,
      agentType: params.agentType,
    } as TradeTechnicalAnalysis

    return {
      bullish: calculateReversalScore(tempAnalysisForScore, 'BULLISH').score,
      bearish: calculateReversalScore(tempAnalysisForScore, 'BEARISH').score,
    }
  }

  public async evaluatePosition(
    kc: any,
    symbol: string,
    openPosition: PaperPosition,
    injectedCandles?: {
      candles1d: Candle[]
      candles1h: Candle[]
      candles30m?: Candle[]
      candles15m: Candle[]
      candles3m: Candle[]
    },
    userId: string = ''
  ) {
    resolveYahooTicker(symbol)

    const [candles, vix, kiteData] = await this.fetchPositionEvalInputs(kc, symbol, injectedCandles)

    const { tf1h, tf30m, tf15m, tf3m } = analyzeMultiTimeframe(
      candles.candles1h,
      candles.candles30m || [],
      candles.candles15m,
      candles.candles3m
    )
    const dailyContext = analyzeDailyContext(candles.candles1d, candles.candles15m)

    const { quotes, finalOptions } = kiteData
    const optionsAnalysisZerodha = analyzeOptions(quotes, finalOptions, tf15m.price, yesterdayOiCache, 5)

    const marketData: MarketContext = {
      tf1h,
      tf30m,
      tf15m,
      tf3m,
      dailyContext,
      optionsAnalysisZerodha,
      vix,
      time: new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false }),
      mode: 'intraday',
    }

    const agentType = await this.resolvePositionAgentType(openPosition, marketData, userId)

    const decision = await this.llmService.managePositionWithAI(
      {
        openPosition,
        marketData,
      },
      agentType,
      userId
    )

    if (decision.decision === 'EXIT') {
      cooldownManager.setCooldown(symbol, 15)
    }

    console.log(
      `[Risk Manager] AI Decision for ${openPosition.symbol}: ${decision.decision} (${agentType} Agent) - ${decision.reason}`
    )

    return { decision, marketData, agentType }
  }

  private async resolvePositionAgentType(
    openPosition: PaperPosition,
    marketData: MarketContext,
    userId: string
  ): Promise<TradingAgentType> {
    const initialAgent: TradingAgentType = openPosition.strategyContext?.agentType || 'SCALPER'
    const orchestrator = await this.llmService.evaluateMarketState(marketData, userId)
    const validation = validateRegime(orchestrator, marketData)
    if (validation.wasOverridden) {
      this.logRegimeOverride(orchestrator.activeAgent, validation)
    }
    if (validation.activeAgent === 'TREND' && initialAgent === 'SCALPER') {
      console.log(`[Orchestrator] UPGRADING position management to TREND agent for ${openPosition.symbol}`)
      return 'TREND'
    }
    return initialAgent
  }

  private logRegimeOverride(originalAgent: string, validation: ValidationResult): void {
    const failedChecks = validation.checks
      .filter((check) => !check.passed)
      .map((check) => `  ✗ ${check.name}: ${check.reason}`)

    console.warn(
      [`[RegimeValidator] OVERRIDE: ${originalAgent} → ${validation.activeAgent}`, ...failedChecks].join('\n')
    )
  }

  private async fetchAnalysisInputs(
    kc: any,
    symbol: string,
    injectedCandles?: {
      candles1d: Candle[]
      candles1h: Candle[]
      candles30m?: Candle[]
      candles15m: Candle[]
      candles3m: Candle[]
    }
  ) {
    if (injectedCandles) {
      const [headlines, vix, kiteData] = await Promise.all([getNews(symbol), getIndiaVix(), getOptionChain(kc, symbol)])
      return [injectedCandles, headlines, vix, kiteData] as const
    }

    const [candlesData, headlines, vix, kiteData] = await Promise.all([
      getMultiTimeframeCandles(symbol, kc),
      getNews(symbol),
      getIndiaVix(),
      getOptionChain(kc, symbol),
    ])

    const candles = {
      candles1d: candlesData.candles1d,
      candles1h: candlesData.candles1h,
      candles30m:
        candlesData.candles30m && candlesData.candles30m.length > 0 ? candlesData.candles30m : candlesData.candles15m,
      candles15m: candlesData.candles15m,
      candles3m: candlesData.candles3m,
    }

    return [candles, headlines, vix, kiteData] as const
  }

  private async resolvePositionCandles(
    kc: any,
    symbol: string,
    injectedCandles: {
      candles1d: Candle[]
      candles1h: Candle[]
      candles30m?: Candle[] | undefined
      candles15m: Candle[]
      candles3m: Candle[]
    }
  ) {
    if (injectedCandles.candles15m.length > 0) return injectedCandles

    console.log(`[Risk Manager] Real-time candles empty for ${symbol}. Falling back to Yahoo baseline.`)
    const macro = await getMultiTimeframeCandles(symbol, kc)
    return {
      candles1d: injectedCandles.candles1d,
      candles1h: injectedCandles.candles1h,
      candles30m: macro.candles30m,
      candles15m: macro.candles15m,
      candles3m: macro.candles3m,
    }
  }

  private async fetchPositionEvalInputs(
    kc: any,
    symbol: string,
    injectedCandles?: {
      candles1d: Candle[]
      candles1h: Candle[]
      candles30m?: Candle[]
      candles15m: Candle[]
      candles3m: Candle[]
    }
  ) {
    if (injectedCandles) {
      const [candles, vix, kiteData] = await Promise.all([
        this.resolvePositionCandles(kc, symbol, injectedCandles),
        getIndiaVix(),
        getOptionChain(kc, symbol),
      ])
      return [candles, vix, kiteData] as const
    }

    const [candlesData, vix, kiteData] = await Promise.all([
      getMultiTimeframeCandles(symbol, kc),
      getIndiaVix(),
      getOptionChain(kc, symbol),
    ])

    const candles = {
      candles1d: candlesData.candles1d,
      candles1h: candlesData.candles1h,
      candles30m: candlesData.candles15m,
      candles15m: candlesData.candles15m,
      candles3m: candlesData.candles3m,
    }

    return [candles, vix, kiteData] as const
  }

  private processAiDecisionFilters(
    aiDecision: any,
    tf15m: any,
    gtiScore: any,
    activeAgent: TradingAgentType = 'SCALPER',
    reversalScore?: { bullish: number; bearish: number }
  ): void {
    if (!aiDecision.optionAction || aiDecision.optionAction === 'NONE') return

    const normalizedConfidence = aiDecision.confidence <= 1.0 ? aiDecision.confidence * 100 : aiDecision.confidence

    if (normalizedConfidence < 60) {
      console.log(`[Analysis] Signal REJECTED: Confidence ${normalizedConfidence}% is below minimum threshold (60%).`)
      aiDecision.decision = 'HOLD'
      aiDecision.optionAction = 'NONE'
      return
    }

    if (normalizedConfidence < 75) {
      console.log(
        `[Analysis] ⚠️ Moderate confidence (${normalizedConfidence}%). Trade ALLOWED with reduced position (1 lot).`
      )
      aiDecision.reducedPosition = true
    }

    if (aiDecision.setup === 'INSTITUTIONAL_TRAP' && reversalScore) {
      const requiredScore = aiDecision.optionAction === 'BUY_CE' ? reversalScore.bullish : reversalScore.bearish
      if (requiredScore < 3) {
        console.warn(
          `[Reversal Score Filter] 🛑 BLOCKED: ${aiDecision.optionAction} rejected — Playbook B INSTITUTIONAL_TRAP requires Reversal Score >= 3/5 (actual: ${requiredScore}/5).`
        )
        aiDecision.decision = 'HOLD'
        aiDecision.optionAction = 'NONE'
        aiDecision.reason = `[REVERSAL SCORE BLOCKED] ${aiDecision.reason} | Playbook B requires Reversal Score >= 3/5 (got ${requiredScore}/5).`
        return
      }
    }

    const zScore15m = tf15m.vwapZScore || 0
    const isWave3Expansion =
      activeAgent === 'TREND' || aiDecision.setup === 'TRUE_BREAKOUT' || tf15m.waveContext?.currentPhase === 'WAVE_3'

    if (!isWave3Expansion && aiDecision.optionAction === 'BUY_CE' && zScore15m > 2.0) {
      console.warn(
        `[VWAP Z-Score Filter] 🛑 BLOCKED: BUY_CE rejected — 15m VWAP Z-Score (${zScore15m.toFixed(2)}) > +2.0 (overbought mean-reversion boundary).`
      )
      aiDecision.decision = 'HOLD'
      aiDecision.optionAction = 'NONE'
      aiDecision.reason = `[VWAP Z-SCORE BLOCKED] ${aiDecision.reason} | Price is overbought (VWAP Z-Score ${zScore15m.toFixed(2)} > +2.0).`
      return
    }

    if (!isWave3Expansion && aiDecision.optionAction === 'BUY_PE' && zScore15m < -2.0) {
      console.warn(
        `[VWAP Z-Score Filter] 🛑 BLOCKED: BUY_PE rejected — 15m VWAP Z-Score (${zScore15m.toFixed(2)}) < -2.0 (oversold mean-reversion boundary).`
      )
      aiDecision.decision = 'HOLD'
      aiDecision.optionAction = 'NONE'
      aiDecision.reason = `[VWAP Z-SCORE BLOCKED] ${aiDecision.reason} | Price is oversold (VWAP Z-Score ${zScore15m.toFixed(2)} < -2.0).`
      return
    }

    this.applyGtiGatekeeper(aiDecision, normalizedConfidence, gtiScore)
  }

  private applyGtiGatekeeper(aiDecision: any, normalizedConfidence: number, gtiScore: any): void {
    if (gtiScore.confidence <= 30) {
      console.log(
        `🎯 AI EXECUTION SIGNAL: ${aiDecision.optionAction} at strike ${aiDecision.strike}${aiDecision.reducedPosition ? ' (REDUCED SIZE)' : ''}`
      )
      console.log(`[GTI] ℹ️ Insufficient GTI data for gatekeeper (confidence: ${gtiScore.confidence.toFixed(0)}%)`)
      return
    }

    const gtiMildThreshold = -0.3
    const gtiSevereThreshold = -0.6
    const isBuySignal = aiDecision.optionAction === 'BUY_CE'
    const isSellSignal = aiDecision.optionAction === 'BUY_PE'
    const gtiMildOpposing =
      (isBuySignal && gtiScore.composite < gtiMildThreshold) || (isSellSignal && gtiScore.composite > -gtiMildThreshold)
    const gtiSevereOpposing =
      (isBuySignal && gtiScore.composite < gtiSevereThreshold) ||
      (isSellSignal && gtiScore.composite > -gtiSevereThreshold)

    if (gtiSevereOpposing) {
      console.warn(
        `[GTI Gatekeeper] 🛑 BLOCKED: ${aiDecision.optionAction} rejected — GTI score ${gtiScore.composite.toFixed(2)} (${gtiScore.classification}) severely opposes this trade.`
      )
      aiDecision.decision = 'HOLD'
      aiDecision.optionAction = 'NONE'
      aiDecision.reason = `[GTI BLOCKED] ${aiDecision.reason} | Institutional flow (${gtiScore.classification}) severely opposes this trade direction.`
      return
    }

    if (gtiMildOpposing) {
      const penalizedConfidence = Math.max(50, normalizedConfidence * 0.7)
      console.warn(
        `[GTI Gatekeeper] ⚠️ WARNING: ${aiDecision.optionAction} — GTI score ${gtiScore.composite.toFixed(2)} (${gtiScore.classification}) mildly opposes. Confidence ${normalizedConfidence}% → ${penalizedConfidence.toFixed(0)}%.`
      )
      aiDecision.confidence = penalizedConfidence
      aiDecision.reducedPosition = true
      aiDecision.reason = `[GTI CAUTION] ${aiDecision.reason} | Institutional flow (${gtiScore.classification}) mildly opposes — reduced sizing applied.`
      console.log(
        `🎯 AI EXECUTION SIGNAL: ${aiDecision.optionAction} at strike ${aiDecision.strike} (REDUCED SIZE — GTI caution)`
      )
      return
    }

    console.log(
      `🎯 AI EXECUTION SIGNAL: ${aiDecision.optionAction} at strike ${aiDecision.strike}${aiDecision.reducedPosition ? ' (REDUCED SIZE)' : ''}`
    )
    console.log(
      `[GTI] ✅ Institutional flow CONFIRMS direction: ${gtiScore.classification} (${gtiScore.composite.toFixed(2)})`
    )
  }

  private logAnalysisSummary(
    liveContext: any,
    vix: any,
    sentiment: any,
    aiDecision: any,
    tf15m: any,
    tf1h: any,
    dailyContext: any,
    gtiScore: any
  ): void {
    if (liveContext) {
      logSection(`🚀 LIVE BREAKOUT TRIGGERED: ${liveContext.reason}`)
    }

    logSection('📊 Market Volatility (VIX)')
    console.log(`India VIX: ${vix.current} (${vix.change}% change)`)
    console.log(`Sentiment: ${vix.sentiment.toUpperCase()}`)

    logSection('📰 Sentiment')
    console.log(`Sentiment: ${sentiment.sentiment}`)
    console.log(`Confidence: ${sentiment.confidence}`)
    console.log(`Reason: ${sentiment.reason}`)

    logSection('🤖 AI Decision')
    console.log(`Decision: ${aiDecision.decision}`)
    console.log(`Setup: ${aiDecision.setup ?? 'N/A'}`)
    console.log(`Reason: ${aiDecision.reason}`)
    console.log(`Confidence: ${aiDecision.confidence}`)
    console.log(`Index SL: ${aiDecision.stopLoss}`)
    console.log(`R:R Ratio: ${aiDecision.riskRewardRatio}`)

    logSection('📊 Multi Timeframe Analysis')
    console.log(`Current Price: ${tf15m.price}`)
    console.log(`Macro Trend (1H): ${tf1h.trend}`)
    console.log(`Intraday Trend (15m): ${tf15m.trend}`)
    if (dailyContext) {
      console.log(
        `Macro Compression: ${dailyContext.isCompression ? 'YES' : 'No'} (PDR: ${dailyContext.pdr.toFixed(2)}, 70% ATR: ${(0.7 * dailyContext.atr14).toFixed(2)})`
      )
    }
    console.log(`VWAP (15m): ${tf15m.vwap.toFixed(2)} (${tf15m.vwapPosition})`)
    console.log(`Resistance (15m): ${tf15m.resistance.toFixed(2)})`)
    console.log(`Support (15m): ${tf15m.support.toFixed(2)})`)

    if (gtiScore.confidence > 0) {
      logSection('🏦 GTI — Institutional Activity')
      console.log(`Composite Score: ${gtiScore.composite.toFixed(3)} (${gtiScore.classification})`)
      console.log(`Confidence: ${gtiScore.confidence.toFixed(0)}%`)
      console.log(`  Volume Anomaly: ${gtiScore.components.volumeAnomaly.toFixed(3)}`)
      console.log(`  CVD: ${gtiScore.components.cvd.toFixed(3)}`)
      console.log(`  VWAP Deviation: ${gtiScore.components.vwapDeviation.toFixed(3)}`)
      console.log(`  OI Signal: ${gtiScore.components.oiSignal.toFixed(3)}`)
      console.log(`  Smart Money Flow: ${gtiScore.components.smartMoneyFlow.toFixed(3)}`)
    }
  }
}

export const tradeAnalysisService = new TradeAnalysisService()

export const runAnalysis = (
  kc: any,
  symbol: string,
  mode: 'intraday' | 'swing' = 'intraday',
  liveContext?: any,
  previousDecision?: any,
  injectedCandles?: {
    candles1d: Candle[]
    candles1h: Candle[]
    candles30m?: Candle[]
    candles15m: Candle[]
    candles3m: Candle[]
  },
  userId: string = ''
): Promise<TradeTechnicalAnalysis> =>
  tradeAnalysisService.runAnalysis(kc, symbol, mode, liveContext, previousDecision, injectedCandles, userId)

export const evaluatePosition = (
  kc: any,
  symbol: string,
  openPosition: PaperPosition,
  injectedCandles?: {
    candles1d: Candle[]
    candles1h: Candle[]
    candles30m?: Candle[]
    candles15m: Candle[]
    candles3m: Candle[]
  },
  userId: string = ''
) => tradeAnalysisService.evaluatePosition(kc, symbol, openPosition, injectedCandles, userId)
