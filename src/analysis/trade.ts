import { getMultiTimeframeCandles } from "../data/yahoo.js"
import { analyzeMultiTimeframe, analyzeDailyContext } from "./technical.js"
import { LLMService } from "../ai/llm.js"
import { getNews } from "../data/news.js"
import { analyzeSentiment } from "./sentiment.js"
import { getOptionChain } from "../data/kite-options.js"
import { analyzeOptions } from "./kite-options.js"
import { getIndiaVix } from "../data/vix.js"
import { getYesterdayClosingOI } from "../data/kite-historical.js"
import type { PaperPosition } from "../execution/types.js"

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
  symbol: string,
  mode: "intraday" | "swing",
  liveContext?: any,
  previousDecision?: any
) {
  const ticker = symbol === "NIFTY" ? "^NSEI" : symbol === "BANKNIFTY" ? "^NSEBANK" : symbol

  const [candlesData, headlines, vix, kiteData] = await Promise.all([
    getMultiTimeframeCandles(ticker),
    getNews(symbol),
    getIndiaVix(),
    getOptionChain(symbol),
  ])

  const { candles1d, candles1h, candles15m, candles3m } = candlesData
  if (candles15m.length === 0) {
    throw new Error("No 15-minute candles found.")
  }
  const { tf1h, tf15m, tf3m } = analyzeMultiTimeframe(candles1h, candles15m, candles3m)
  const dailyContext = analyzeDailyContext(candles1d)

  const sentiment = await analyzeSentiment(headlines)

  const { quotes, finalOptions } = kiteData

  // Establish Baseline Yesterday OI
  if (!yesterdayOiCache || lastCacheSymbol !== symbol) {
    const tokens = finalOptions.map((opt) => opt.instrument_token).filter((t): t is number => !!t)
    yesterdayOiCache = await getYesterdayClosingOI(tokens)
    lastCacheSymbol = symbol
  }

  // Analyze Options with 5m COI Shift and Buildup States
  const intervalMins = Number(process.env.OI_SHIFT_INTERVAL_MINS || 5)
  const optionsAnalysisZerodha = analyzeOptions(quotes, finalOptions, tf15m.price, yesterdayOiCache, intervalMins)

  const aiDecision = await llmService.analyzeWithAI({
    tf1h,
    tf15m,
    tf3m,
    dailyContext,
    sentiment,
    optionsAnalysisZerodha,
    vix,
    mode,
    liveContext,
    previousDecision,
  })

  if (aiDecision.optionAction && aiDecision.optionAction !== "NONE") {
    console.log(`🎯 AI EXECUTION SIGNAL: ${aiDecision.optionAction} at strike ${aiDecision.strike}`)
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
  console.log(`Index SL: ${aiDecision.indexStopLoss}`)
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

  return {
    tf1h,
    tf15m,
    tf3m,
    dailyContext,
    aiDecision,
    vix,
    sentiment,
    optionsAnalysis: optionsAnalysisZerodha,
    candles1h: candles1h.slice(-100),
    candles15m: candles15m.slice(-100),
    candles3m: candles3m.slice(-100),
  }
}

export async function evaluatePosition(symbol: string, openPosition: PaperPosition) {
  const ticker = symbol === "NIFTY" ? "^NSEI" : symbol === "BANKNIFTY" ? "^NSEBANK" : symbol

  const [candlesData, vix, kiteData] = await Promise.all([
    getMultiTimeframeCandles(ticker),
    getIndiaVix(),
    getOptionChain(symbol),
  ])

  const { candles1d, candles1h, candles15m, candles3m } = candlesData
  const { tf1h, tf15m, tf3m } = analyzeMultiTimeframe(candles1h, candles15m, candles3m)
  const dailyContext = analyzeDailyContext(candles1d)

  const { quotes, finalOptions } = kiteData

  // Analyze Options
  const optionsAnalysisZerodha = analyzeOptions(quotes, finalOptions, tf15m.price, yesterdayOiCache, 5)

  const marketData = {
    tf1h,
    tf15m,
    tf3m,
    dailyContext,
    optionsAnalysisZerodha,
    vix,
  }

  const decision = await llmService.managePositionWithAI({
    openPosition,
    marketData,
  })

  console.log(`[Risk Manager] AI Decision for ${openPosition.symbol}: ${decision.decision} - ${decision.reason}`)

  return { decision, marketData }
}
