import type { FifteenMinuteCandle } from "../types/analysis.js";
import { getDualTimeframeCandles } from "../data/yahoo.js";
import { analyzeDualTimeframe } from "./technical.js";
import { analyzeWithAI } from "../ai/llm.js";
import { getNews } from "../data/news.js";
import { analyzeSentiment } from "./sentiment.js";
import { getOptionChain } from "../data/kite-options.js";
import { analyzeOptions } from "./kite-options.js";
import { getIndiaVix } from "../data/vix.js";
import { getYesterdayClosingOI } from "../data/kite-historical.js";
import type { Analysis, TradePlan } from "../types/analysis.js"
import type { MarketMode } from "../types/mode.js"


const divider = "═".repeat(50)

function logSection(title: string) {
  console.log(`\n${divider}`)
  console.log(title)
  console.log(`${divider}\n`)
}

// Cache for baseline data
let yesterdayOiCache: Map<number, number> | undefined = undefined;
let lastCacheSymbol: string | null = null;

export async function runAnalysis(symbol: string, mode: "intraday" | "swing", liveContext?: any, previousDecision?: any) {
  const ticker = symbol === "NIFTY" ? "^NSEI" : symbol === "BANKNIFTY" ? "^NSEBANK" : symbol

  const [candlesData, headlines, vix, kiteData] = await Promise.all([
    getDualTimeframeCandles(ticker),
    getNews(symbol),
    getIndiaVix(),
    getOptionChain(symbol),
  ])

  const { candles15m, candles5m } = candlesData
  if (candles15m.length === 0) {
    throw new Error("No 15-minute candles found.")
  }
  const { tf15m, tf5m } = analyzeDualTimeframe(candles15m, candles5m)

  const last15mCandle = candles15m[candles15m.length - 1]!
  const full15mAnalysis: FifteenMinuteCandle = {
      ...last15mCandle,
      ...tf15m
  }

  const sentiment = await analyzeSentiment(headlines)

  const { quotes, finalOptions } = kiteData

  // Establish Baseline Yesterday OI
  if (!yesterdayOiCache || lastCacheSymbol !== symbol) {
    const tokens = finalOptions.map(opt => opt.instrument_token).filter((t): t is number => !!t)
    yesterdayOiCache = await getYesterdayClosingOI(tokens)
    lastCacheSymbol = symbol
  }

  // Analyze Options with 5m COI Shift and Buildup States
  const intervalMins = Number(process.env.OI_SHIFT_INTERVAL_MINS || 5)
  const optionsAnalysisZerodha = analyzeOptions(quotes, finalOptions, tf15m.price, yesterdayOiCache, intervalMins)
  
  const aiDecision = await analyzeWithAI({
    tf15m,
    tf5m,
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
  console.log(`Entry: ${aiDecision.entry}`)
  console.log(`SL: ${aiDecision.stopLoss}`)
  console.log(`Targets: ${aiDecision.targets?.join(", ")}`)

  logSection("📊 Dual Timeframe Analysis")
  console.log(`Current Price: ${tf15m.price}`)
  console.log(`Trend: ${tf15m.trend}`)
  console.log(`VWAP: ${tf15m.vwap.toFixed(2)} (${tf15m.vwapPosition})`)
  console.log(`Resistance: ${tf15m.resistance.toFixed(2)}`)
  console.log(`Support: ${tf15m.support.toFixed(2)}`)

  return { 
    tf15m, 
    tf5m, 
    aiDecision, 
    vix, 
    sentiment, 
    optionsAnalysis: optionsAnalysisZerodha,
    candles15m: candles15m.slice(-100), // Return last 100 for context
    candles5m: candles5m.slice(-100) 
  }
}
