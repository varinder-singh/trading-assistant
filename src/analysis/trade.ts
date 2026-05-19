import type { FifteenMinuteCandle } from "../types/analysis.js";
import { getDualTimeframeCandles } from "../data/yahoo.js";
import { analyzeDualTimeframe } from "./technical.js";
import { analyzeWithAI } from "../ai/llm.js";
import { getNews } from "../data/news.js";
import { analyzeSentiment } from "./sentiment.js";
import { getOptionChain } from "../data/kite-options.js";
import { analyzeOptions } from "./kite-options.js";
import { getIndiaVix } from "../data/vix.js";
import type { Analysis, TradePlan } from "../types/analysis.js"
import type { MarketMode } from "../types/mode.js"


const divider = "═".repeat(50)

function logSection(title: string) {
  console.log(`\n${divider}`)
  console.log(title)
  console.log(`${divider}\n`)
}

export function generateTradePlan(tf: FifteenMinuteCandle, mode: "intraday" | "swing") {
  const { trend, price, vwap, resistance, support, rsi, vwapPosition } = tf;

  // Simplified logic, can be expanded
  if (mode === "swing") {
    if (trend === "up" && vwapPosition === "above") {
      return {
        decision: "BUY",
        entry: price,
        stopLoss: support,
        targets: [resistance, resistance + (resistance - support)],
      };
    } else if (trend === "down" && vwapPosition === "below") {
      return {
        decision: "SELL",
        entry: price,
        stopLoss: resistance,
        targets: [support, support - (resistance - support)],
      };
    }
  } else { // Intraday
    if (trend === "up" && rsi < 60) {
      return {
        decision: "BUY",
        entry: price,
        stopLoss: vwap,
        targets: [resistance],
      };
    } else if (trend === "down" && rsi > 40) {
      return {
        decision: "SELL",
        entry: price,
        stopLoss: vwap,
        targets: [support],
      };
    }
  }
  
  return {
    decision: "NEUTRAL"
  }
}
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

  generateTradePlan(full15mAnalysis, mode)

  const sentiment = await analyzeSentiment(headlines)

  const { quotes, finalOptions } = kiteData
  const optionsAnalysisZerodha = analyzeOptions(quotes, finalOptions, tf15m.price)
  
  const aiDecision = await analyzeWithAI({
...
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

  return { tf15m, tf5m, aiDecision, vix, sentiment }
}
