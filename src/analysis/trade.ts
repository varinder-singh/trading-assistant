import { getMultiTimeframeCandles } from "../data/yahoo.js"
import { analyzeMultiTimeframe, analyzeDailyContext } from "./technical.js"
import { LLMService } from "../ai/llm.js"
import { validateRegime } from "../ai/regime-validator.js"
import { getNews } from "../data/news.js"
import { analyzeSentiment } from "./sentiment.js"
import { getOptionChain } from "../data/kite-options.js"
import { analyzeOptions } from "./kite-options.js"
import { getIndiaVix } from "../data/vix.js"
import { getYesterdayClosingOI } from "../data/kite-historical.js"
import type { PaperPosition } from "../execution/types.js"
import type { MarketContext, TradingAgentType } from "../ai/types.js"
import { cooldownManager } from "../utils/cooldown.js"
import type { Candle, TradeTechnicalAnalysis } from "../types/analysis.js"
import { getInstrumentToken } from "../data/kite.js"
import { gtiTracker } from "../indicators/gti-tracker.js"

const llmService = new LLMService()

const divider = "═".repeat(50)

function logSection(title: string) {
  console.log(`\n${divider}`)
  console.log(title)
  console.log(`${divider}\n`)
}

// Cache for baseline data
let yesterdayOiCache: Map<number, number> | undefined = undefined
let lastCacheSymbol: string | null = null

export async function runAnalysis(
  kc: any, // KiteConnect instance
  symbol: string,
  mode: "intraday" | "swing",
  liveContext?: any,
  previousDecision?: any,
  injectedCandles?: {
    candles1d: Candle[]
    candles1h: Candle[]
    candles30m: Candle[]
    candles15m: Candle[]
    candles3m: Candle[]
  }
): Promise<TradeTechnicalAnalysis> {
  const ticker = symbol === "NIFTY" ? "^NSEI" : symbol === "BANKNIFTY" ? "^NSEBANK" : symbol

  let candles1d, candles1h, candles30m, candles15m, candles3m
  let headlines, vix, kiteData

  if (injectedCandles) {
    candles1d = injectedCandles.candles1d
    candles1h = injectedCandles.candles1h
    candles30m = injectedCandles.candles30m
    candles15m = injectedCandles.candles15m
    candles3m = injectedCandles.candles3m
    ;[headlines, vix, kiteData] = await Promise.all([getNews(symbol), getIndiaVix(), getOptionChain(kc, symbol)])
  } else {
    const [candlesData, h, v, k] = await Promise.all([
      getMultiTimeframeCandles(ticker),
      getNews(symbol),
      getIndiaVix(),
      getOptionChain(kc, symbol),
    ])

    candles1d = candlesData.candles1d
    candles1h = candlesData.candles1h
    candles30m = candlesData.candles30m || candlesData.candles15m
    candles15m = candlesData.candles15m
    candles3m = candlesData.candles3m
    headlines = h
    vix = v
    kiteData = k
  }

  if (candles15m.length === 0) {
    throw new Error("No 15-minute candles found.")
  }

  const { tf1h, tf30m, tf15m, tf3m } = analyzeMultiTimeframe(candles1h, candles30m, candles15m, candles3m)
  const dailyContext = analyzeDailyContext(candles1d, candles15m)

  const { quotes, finalOptions } = kiteData

  // Establish Baseline Yesterday OI
  if (!yesterdayOiCache || lastCacheSymbol !== symbol) {
    const tokens = finalOptions.map((opt) => opt.instrument_token).filter((t): t is number => !!t)
    yesterdayOiCache = await getYesterdayClosingOI(kc, tokens)
    lastCacheSymbol = symbol
  }

  // Analyze Options with 5m COI Shift and Buildup States
  const intervalMins = Number(process.env.OI_SHIFT_INTERVAL_MINS || 5)
  const optionsAnalysisZerodha = analyzeOptions(quotes, finalOptions, tf15m.price, yesterdayOiCache, intervalMins)

  // Fetch IV Rank
  const { ivHistoryRepo } = await import("../db/repositories/iv-history.js")
  // We get the ATM IV from the optionsAnalysisZerodha rows
  const atmRow = optionsAnalysisZerodha.rows.find(
    (r) => r.strike === optionsAnalysisZerodha.atmStrike && r.type === "CE"
  )
  const currentIv = atmRow?.greeks?.iv || 0.15
  const ivStats = await ivHistoryRepo.getIvStats(symbol, currentIv, 30)
  optionsAnalysisZerodha.ivRank = ivStats.ivRank
  optionsAnalysisZerodha.ivPercentile = ivStats.ivPercentile

  if (cooldownManager.isOnCooldown(symbol) || vix.current > 25) {
    const reason = cooldownManager.isOnCooldown(symbol) ? "Symbol on Cooldown" : "VIX > 25 Circuit Breaker"
    console.log(`[Circuit Breaker] Aborting analysis for ${symbol}: ${reason}`)
    return {
      tf1h,
      tf30m,
      tf15m,
      tf3m,
      dailyContext,
      vix,
      sentiment: { sentiment: "neutral", confidence: 1, reason: "Skipped due to circuit breaker" },
      optionsAnalysis: optionsAnalysisZerodha,
      candles1h: candles1h.slice(-100),
      candles30m: candles30m.slice(-100),
      candles15m: candles15m.slice(-100),
      candles3m: candles3m.slice(-100),
      agentType: "SCALPER",
      aiDecision: {
        decision: "NO_TRADE",
        reason,
        confidence: 100,
        optionAction: "NONE",
        setup: "NONE",
        riskRewardRatio: 0,
        entry: 0,
        stopLoss: 0,
        targets: [],
        instrument: "OPTIONS",
        strike: null,
        macroTrend: "SIDEWAYS",
      },
    }
  }

  const sentiment = await analyzeSentiment(headlines)

  // 1. Call Orchestrator to decide agent
  // Get current GTI score for the watched token (if available)
  const underlyingToken = await getInstrumentToken(kc, symbol)
  if (underlyingToken) {
    gtiTracker.setMarketContext(underlyingToken, tf15m.vwap, dailyContext?.atr14 || 1, optionsAnalysisZerodha.flow)
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
    time: new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour12: false }),
  }

  if (gtiScore && gtiScore.confidence > 0) {
    marketContext.gtiScore = gtiScore
  }
  const orchestrator = await llmService.evaluateMarketState(marketContext)
  const validation = validateRegime(orchestrator, marketContext)
  if (validation.wasOverridden) {
    console.warn(`[RegimeValidator] OVERRIDE: ${orchestrator.activeAgent} → ${validation.activeAgent}`)
    validation.checks.filter((c) => !c.passed).forEach((c) => console.warn(`  ✗ ${c.name}: ${c.reason}`))
  } else {
    console.log(`[Orchestrator] Active Agent: ${validation.activeAgent} (${orchestrator.confidence}%)`)
    console.log(`[Orchestrator] Rationale: ${orchestrator.rationale}`)
  }
  const activeAgent = validation.activeAgent

  // Compute reversal score early to pass it to the AI
  const { calculateReversalScore } = await import("./reversals.js")
  // We mock a temporary TradeTechnicalAnalysis object just to calculate the score
  const tempAnalysisForScore = {
    tf1h,
    tf30m,
    tf15m,
    tf3m,
    dailyContext,
    vix,
    sentiment,
    optionsAnalysis: optionsAnalysisZerodha,
    candles1h,
    candles30m,
    candles15m,
    candles3m,
    agentType: activeAgent,
  } as TradeTechnicalAnalysis

  const reversalScore = {
    bullish: calculateReversalScore(tempAnalysisForScore, "BULLISH").score,
    bearish: calculateReversalScore(tempAnalysisForScore, "BEARISH").score,
  }

  // 2. Run analysis with the ensemble of agents
  const aiDecision = await llmService.analyzeWithEnsemble(
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
      reversalScore, // Pass the reversal score to the AI
    },
    activeAgent
  )

  if (!aiDecision) {
    return {
      tf1h,
      tf30m,
      tf15m,
      tf3m,
      dailyContext,
      aiDecision: {
        decision: "NO_TRADE",
        reason: "No active trend + high VIX structure requires sitting out.",
        confidence: 100,
        optionAction: "NONE",
        setup: "NONE",
        riskRewardRatio: 0,
        stopLoss: 0,
        entry: 0,
        targets: [],
        instrument: "OPTIONS",
        strike: null,
        macroTrend: mode,
      },
      vix,
      sentiment,
      optionsAnalysis: optionsAnalysisZerodha,
      candles1h: candles1h.slice(-100),
      candles30m: candles30m.slice(-100),
      candles15m: candles15m.slice(-100),
      candles3m: candles3m.slice(-100),
      agentType: activeAgent || "SCALPER",
      gtiHistory: gtiTracker.getHistory(0),
    }
  }

  // Robust Confidence Check (Handle 0.0-1.0 and 0-100 scales)
  let normalizedConfidence = aiDecision.confidence
  if (normalizedConfidence <= 1.0) normalizedConfidence *= 100

  if (aiDecision.optionAction && aiDecision.optionAction !== "NONE") {
    if (normalizedConfidence < 75) {
      console.log(`[Analysis] Signal REJECTED: Confidence ${normalizedConfidence}% is below threshold (75%).`)
      aiDecision.decision = "HOLD"
      // Note: We keep entry/stopLoss/targets so they show in the UI as "Planned" levels
      aiDecision.optionAction = "NONE"
    } else {
      // GTI Gatekeeper: Block trades that strongly oppose institutional flow
      const gtiGatekeeperThreshold = -0.3
      if (gtiScore.confidence > 30) {
        const isBuySignal = aiDecision.optionAction === "BUY_CE"
        const isSellSignal = aiDecision.optionAction === "BUY_PE"
        const gtiOpposing =
          (isBuySignal && gtiScore.composite < gtiGatekeeperThreshold) ||
          (isSellSignal && gtiScore.composite > -gtiGatekeeperThreshold)

        if (gtiOpposing) {
          console.warn(
            `[GTI Gatekeeper] ⚠️ BLOCKED: ${aiDecision.optionAction} rejected — GTI score ${gtiScore.composite.toFixed(2)} (${gtiScore.classification}) opposes this trade direction.`
          )
          aiDecision.decision = "HOLD"
          aiDecision.optionAction = "NONE"
          aiDecision.reason = `[GTI BLOCKED] ${aiDecision.reason} | Institutional flow (${gtiScore.classification}) opposes this trade direction.`
        } else {
          console.log(`🎯 AI EXECUTION SIGNAL: ${aiDecision.optionAction} at strike ${aiDecision.strike}`)
          console.log(
            `[GTI] ✅ Institutional flow CONFIRMS direction: ${gtiScore.classification} (${gtiScore.composite.toFixed(2)})`
          )
        }
      } else {
        console.log(`🎯 AI EXECUTION SIGNAL: ${aiDecision.optionAction} at strike ${aiDecision.strike}`)
        console.log(`[GTI] ℹ️ Insufficient GTI data for gatekeeper (confidence: ${gtiScore.confidence.toFixed(0)}%)`)
      }
    }
  }

  if (liveContext) {
    logSection(`🚀 LIVE BREAKOUT TRIGGERED: ${liveContext.reason}`)
  }

  logSection("📊 Market Volatility (VIX)")
  console.log(`India VIX: ${vix.current} (${vix.change}% change)`)
  console.log(`Sentiment: ${vix.sentiment.toUpperCase()}`)

  logSection("📰 Sentiment")
  console.log(`Sentiment: ${sentiment.sentiment}`)
  console.log(`Confidence: ${sentiment.confidence}`)
  console.log(`Reason: ${sentiment.reason}`)

  logSection("🤖 AI Decision")
  console.log(`Decision: ${aiDecision.decision}`)
  console.log(`Setup: ${aiDecision.setup ?? "N/A"}`)
  console.log(`Reason: ${aiDecision.reason}`)
  console.log(`Confidence: ${aiDecision.confidence}`)
  console.log(`Index SL: ${aiDecision.stopLoss}`)
  console.log(`R:R Ratio: ${aiDecision.riskRewardRatio}`)

  logSection("📊 Multi Timeframe Analysis")
  console.log(`Current Price: ${tf15m.price}`)
  console.log(`Macro Trend (1H): ${tf1h.trend}`)
  console.log(`Intraday Trend (15m): ${tf15m.trend}`)
  if (dailyContext) {
    console.log(
      `Macro Compression: ${dailyContext.isCompression ? "YES" : "No"} (PDR: ${dailyContext.pdr.toFixed(2)}, 70% ATR: ${(0.7 * dailyContext.atr14).toFixed(2)})`
    )
  }
  console.log(`VWAP (15m): ${tf15m.vwap.toFixed(2)} (${tf15m.vwapPosition})`)
  console.log(`Resistance (15m): ${tf15m.resistance.toFixed(2)}`)
  console.log(`Support (15m): ${tf15m.support.toFixed(2)}`)

  if (gtiScore.confidence > 0) {
    logSection("🏦 GTI — Institutional Activity")
    console.log(`Composite Score: ${gtiScore.composite.toFixed(3)} (${gtiScore.classification})`)
    console.log(`Confidence: ${gtiScore.confidence.toFixed(0)}%`)
    console.log(`  Volume Anomaly: ${gtiScore.components.volumeAnomaly.toFixed(3)}`)
    console.log(`  CVD: ${gtiScore.components.cvd.toFixed(3)}`)
    console.log(`  VWAP Deviation: ${gtiScore.components.vwapDeviation.toFixed(3)}`)
    console.log(`  OI Signal: ${gtiScore.components.oiSignal.toFixed(3)}`)
    console.log(`  Smart Money Flow: ${gtiScore.components.smartMoneyFlow.toFixed(3)}`)
  }

  const baseAnalysis: Omit<TradeTechnicalAnalysis, "reversalScore"> = {
    tf1h,
    tf30m,
    tf15m,
    tf3m,
    dailyContext,
    aiDecision,
    vix,
    sentiment,
    optionsAnalysis: optionsAnalysisZerodha,
    candles1h: candles1h.slice(-100),
    candles30m: candles30m.slice(-100),
    candles15m: candles15m.slice(-100),
    candles3m: candles3m.slice(-100),
    agentType: activeAgent,
    gtiHistory: gtiTracker.getHistory(0), // Will be overridden by WS server with actual token
  }

  return {
    ...baseAnalysis,
    reversalScore, // Now reusing the score calculated earlier
  }
}

export async function evaluatePosition(
  kc: any,
  symbol: string,
  openPosition: PaperPosition,
  injectedCandles?: {
    candles1d: Candle[]
    candles1h: Candle[]
    candles30m: Candle[]
    candles15m: Candle[]
    candles3m: Candle[]
  }
) {
  const ticker = symbol === "NIFTY" ? "^NSEI" : symbol === "BANKNIFTY" ? "^NSEBANK" : symbol

  let candles1d, candles1h, candles30m, candles15m, candles3m
  let vix, kiteData

  if (injectedCandles) {
    candles1d = injectedCandles.candles1d
    candles1h = injectedCandles.candles1h
    candles30m = injectedCandles.candles30m
    candles15m = injectedCandles.candles15m
    candles3m = injectedCandles.candles3m

    // FALLBACK: If real-time candles (from CandleBuilder) are not yet seeded, use Yahoo baseline
    if (candles15m.length === 0) {
      console.log(`[Risk Manager] Real-time candles empty for ${symbol}. Falling back to Yahoo baseline.`)
      const macro = await getMultiTimeframeCandles(ticker)
      candles30m = macro.candles30m
      candles15m = macro.candles15m
      candles3m = macro.candles3m
    }

    ;[vix, kiteData] = await Promise.all([getIndiaVix(), getOptionChain(kc, symbol)])
  } else {
    const [candlesData, v, k] = await Promise.all([
      getMultiTimeframeCandles(ticker),
      getIndiaVix(),
      getOptionChain(kc, symbol),
    ])

    candles1d = candlesData.candles1d
    candles1h = candlesData.candles1h
    candles15m = candlesData.candles15m
    candles3m = candlesData.candles3m
    candles30m = candles15m // Mock
    vix = v
    kiteData = k
  }

  const { tf1h, tf30m, tf15m, tf3m } = analyzeMultiTimeframe(candles1h, candles30m, candles15m, candles3m)
  const dailyContext = analyzeDailyContext(candles1d, candles15m)

  const { quotes, finalOptions } = kiteData

  // Analyze Options
  const optionsAnalysisZerodha = analyzeOptions(quotes, finalOptions, tf15m.price, yesterdayOiCache, 5)

  const marketData: MarketContext = {
    tf1h,
    tf30m,
    tf15m,
    tf3m,
    dailyContext,
    optionsAnalysisZerodha,
    vix,
    time: new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour12: false }),
    mode: "intraday", // Default for evaluation
  }

  // Determine agent type for management
  // If the position was opened by SCALPER, check if orchestrator wants to upgrade to TREND
  let agentType: TradingAgentType = openPosition.strategyContext?.agentType || "SCALPER"

  const orchestrator = await llmService.evaluateMarketState(marketData)
  const validation = validateRegime(orchestrator, marketData)
  if (validation.wasOverridden) {
    console.warn(`[RegimeValidator] OVERRIDE: ${orchestrator.activeAgent} → ${validation.activeAgent}`)
    validation.checks.filter((c) => !c.passed).forEach((c) => console.warn(`  ✗ ${c.name}: ${c.reason}`))
  }
  if (validation.activeAgent === "TREND" && agentType === "SCALPER") {
    console.log(`[Orchestrator] UPGRADING position management to TREND agent for ${openPosition.symbol}`)
    agentType = "TREND"
  }

  const decision = await llmService.managePositionWithAI(
    {
      openPosition,
      marketData,
    },
    agentType
  )

  if (decision.decision === "EXIT") {
    cooldownManager.setCooldown(symbol, 15)
  }

  console.log(
    `[Risk Manager] AI Decision for ${openPosition.symbol}: ${decision.decision} (${agentType} Agent) - ${decision.reason}`
  )

  return { decision, marketData, agentType }
}
