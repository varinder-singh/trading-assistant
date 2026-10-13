import { getMultiTimeframeCandles } from '../data/yahoo.js'
import { analyzeMultiTimeframe, analyzeDailyContext } from './technical.js'
import { LLMService } from '../ai/llm.js'
import { validateRegime } from '../ai/regime-validator.js'
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

    if (!yesterdayOiCache || lastCacheSymbol !== symbol) {
      const tokens = finalOptions.map((opt: any) => opt.instrument_token).filter((t: any): t is number => !!t)
      yesterdayOiCache = await getYesterdayClosingOI(kc, tokens)
      lastCacheSymbol = symbol
    }

    const intervalMins = Number(process.env.OI_SHIFT_INTERVAL_MINS || 5)
    const optionsAnalysisZerodha = analyzeOptions(quotes, finalOptions, tf15m.price, yesterdayOiCache, intervalMins)

    const { ivHistoryRepo } = await import('../db/repositories/iv-history.js')
    const atmRow = optionsAnalysisZerodha.rows.find(
      (r) => r.strike === optionsAnalysisZerodha.atmStrike && r.type === 'CE'
    )
    const currentIv = atmRow?.greeks?.iv || 0.15
    const ivStats = await ivHistoryRepo.getIvStats(symbol, currentIv, 30)
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

    if (cooldownManager.isOnCooldown(symbol) || vix.current > 25) {
      const reason = cooldownManager.isOnCooldown(symbol) ? 'Symbol on Cooldown' : 'VIX > 25 Circuit Breaker'
      console.log(`[Circuit Breaker] Aborting analysis for ${symbol}: ${reason}`)
      return {
        tf1h,
        tf30m,
        tf15m,
        tf3m,
        dailyContext,
        vix,
        sentiment: { sentiment: 'neutral', confidence: 1, reason: 'Skipped due to circuit breaker' },
        optionsAnalysis: optionsAnalysisZerodha,
        candles1h: candles.candles1h.slice(-100),
        candles30m: candles.candles30m ? candles.candles30m.slice(-100) : [],
        candles15m: candles.candles15m.slice(-100),
        candles3m: candles.candles3m.slice(-100),
        agentType: 'SCALPER',
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
          macroTrend: 'SIDEWAYS',
        },
      }
    }

    const sentiment = await analyzeSentiment(headlines)
    const underlyingToken = await getInstrumentToken(kc, symbol)
    if (underlyingToken) {
      gtiTracker.setMarketContext(underlyingToken, tf15m.vwap, dailyContext?.atr14 || 1, {
        sentiment: optionsAnalysisZerodha.sentiment,
      })
    }
    const gtiScore = gtiTracker.getCurrentScore(underlyingToken || 0)

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
    }

    if (gtiScore && gtiScore.confidence > 0) {
      marketContext.gtiScore = gtiScore
    }
    const orchestrator = await this.llmService.evaluateMarketState(marketContext, userId)
    const validation = validateRegime(orchestrator, marketContext)
    if (validation.wasOverridden) {
      console.warn(`[RegimeValidator] OVERRIDE: ${orchestrator.activeAgent} → ${validation.activeAgent}`)
      validation.checks.filter((c) => !c.passed).forEach((c) => console.warn(`  ✗ ${c.name}: ${c.reason}`))
    } else {
      console.log(`[Orchestrator] Active Agent: ${validation.activeAgent} (${orchestrator.confidence}%)`)
      console.log(`[Orchestrator] Rationale: ${orchestrator.rationale}`)
    }
    const activeAgent = validation.activeAgent as TradingAgentType

    const tempAnalysisForScore = {
      tf1h,
      tf30m,
      tf15m,
      tf3m,
      dailyContext,
      vix,
      sentiment,
      optionsAnalysis: optionsAnalysisZerodha,
      candles1h: candles.candles1h,
      candles15m: candles.candles15m,
      candles3m: candles.candles3m,
      agentType: activeAgent,
    } as TradeTechnicalAnalysis

    const reversalScore = {
      bullish: calculateReversalScore(tempAnalysisForScore, 'BULLISH').score,
      bearish: calculateReversalScore(tempAnalysisForScore, 'BEARISH').score,
    }

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
        tf1h,
        tf30m,
        tf15m,
        tf3m,
        dailyContext,
        aiDecision: {
          decision: 'NO_TRADE',
          reason: 'No active trend + high VIX structure requires sitting out.',
          confidence: 100,
          optionAction: 'NONE',
          setup: 'NONE',
          riskRewardRatio: 0,
          stopLoss: 0,
          entry: 0,
          targets: [],
          instrument: 'OPTIONS',
          strike: null,
          macroTrend: mode,
        },
        vix,
        sentiment,
        optionsAnalysis: optionsAnalysisZerodha,
        candles1h: candles.candles1h.slice(-100),
        candles30m: candles.candles30m ? candles.candles30m.slice(-100) : [],
        candles15m: candles.candles15m.slice(-100),
        candles3m: candles.candles3m.slice(-100),
        agentType: activeAgent || 'SCALPER',
        gtiHistory: gtiTracker.getHistory(0),
      }
    }

    this.processAiDecisionFilters(aiDecision, tf15m, gtiScore)
    this.logAnalysisSummary(liveContext, vix, sentiment, aiDecision, tf15m, tf1h, dailyContext, gtiScore)

    const baseAnalysis: Omit<TradeTechnicalAnalysis, 'reversalScore'> = {
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
      agentType: (activeAgent || 'SCALPER') as import('../ai/types.js').TradingAgentType,
      gtiHistory: gtiTracker.getHistory(0),
      lotSize: lotSize || 1,
    }

    return {
      ...baseAnalysis,
      reversalScore,
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

    let agentType: TradingAgentType = openPosition.strategyContext?.agentType || 'SCALPER'

    const orchestrator = await this.llmService.evaluateMarketState(marketData, userId)
    const validation = validateRegime(orchestrator, marketData)
    if (validation.wasOverridden) {
      console.warn(`[RegimeValidator] OVERRIDE: ${orchestrator.activeAgent} → ${validation.activeAgent}`)
      validation.checks.filter((c) => !c.passed).forEach((c) => console.warn(`  ✗ ${c.name}: ${c.reason}`))
    }
    if (validation.activeAgent === 'TREND' && agentType === 'SCALPER') {
      console.log(`[Orchestrator] UPGRADING position management to TREND agent for ${openPosition.symbol}`)
      agentType = 'TREND'
    }

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
      let candles15m = injectedCandles.candles15m
      let candles30m = injectedCandles.candles30m
      let candles3m = injectedCandles.candles3m

      if (candles15m.length === 0) {
        console.log(`[Risk Manager] Real-time candles empty for ${symbol}. Falling back to Yahoo baseline.`)
        const macro = await getMultiTimeframeCandles(symbol, kc)
        candles30m = macro.candles30m
        candles15m = macro.candles15m
        candles3m = macro.candles3m
      }

      const candles = {
        candles1d: injectedCandles.candles1d,
        candles1h: injectedCandles.candles1h,
        candles30m,
        candles15m,
        candles3m,
      }

      const [vix, kiteData] = await Promise.all([getIndiaVix(), getOptionChain(kc, symbol)])
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

  private processAiDecisionFilters(aiDecision: any, tf15m: any, gtiScore: any): void {
    if (!aiDecision.optionAction || aiDecision.optionAction === 'NONE') return

    let normalizedConfidence = aiDecision.confidence
    if (normalizedConfidence <= 1.0) normalizedConfidence *= 100

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

    const zScore15m = tf15m.vwapZScore || 0
    if (aiDecision.optionAction === 'BUY_CE' && zScore15m > 2.0) {
      console.warn(
        `[VWAP Z-Score Filter] 🛑 BLOCKED: BUY_CE rejected — 15m VWAP Z-Score (${zScore15m.toFixed(2)}) > +2.0 (overbought top).`
      )
      aiDecision.decision = 'HOLD'
      aiDecision.optionAction = 'NONE'
      aiDecision.reason = `[VWAP Z-SCORE BLOCKED] ${aiDecision.reason} | Price is overbought (VWAP Z-Score ${zScore15m.toFixed(2)} > +2.0).`
      return
    }

    if (aiDecision.optionAction === 'BUY_PE' && zScore15m < -2.0) {
      console.warn(
        `[VWAP Z-Score Filter] 🛑 BLOCKED: BUY_PE rejected — 15m VWAP Z-Score (${zScore15m.toFixed(2)}) < -2.0 (oversold bottom).`
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
    } else if (gtiMildOpposing) {
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
    } else {
      console.log(
        `🎯 AI EXECUTION SIGNAL: ${aiDecision.optionAction} at strike ${aiDecision.strike}${aiDecision.reducedPosition ? ' (REDUCED SIZE)' : ''}`
      )
      console.log(
        `[GTI] ✅ Institutional flow CONFIRMS direction: ${gtiScore.classification} (${gtiScore.composite.toFixed(2)})`
      )
    }
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
