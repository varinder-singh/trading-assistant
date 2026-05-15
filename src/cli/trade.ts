import "dotenv/config"
import { Command } from "commander"
import { getDualTimeframeCandles } from "../data/yahoo.js"
import { analyzeDualTimeframe } from "../analysis/technical.js"
import { generateTradePlan } from "../analysis/trade.js"
import { analyzeWithAI } from "../ai/llm.js"
import { getNews } from "../data/news.js"
import { analyzeSentiment } from "../analysis/sentiment.js"
import { getOptionChain } from "../data/kite-options.js"
import { analyzeOptions, formatOptionsAnalysisForLog } from "../analysis/kite-options.js"
import { getIndiaVix } from "../data/vix.js"

import { getInstrumentToken } from "../data/kite.js"
import { createTicker } from "../data/kite-ticker.js"
import { LiveAnalyzer } from "../analysis/live.js"

const program = new Command()
const divider = "═".repeat(50)

function logSection(title: string) {
  console.log(`\n${divider}`)
  console.log(title)
  console.log(`${divider}\n`)
}

function logSubsection(title: string) {
  console.log(`\n${"─".repeat(50)}`)
  console.log(title)
  console.log(`${"─".repeat(50)}\n`)
}

async function runAnalysis(symbol: string, mode: "intraday" | "swing", liveContext?: any) {
  const ticker = symbol === "NIFTY" ? "^NSEI" : symbol === "BANKNIFTY" ? "^NSEBANK" : symbol

  const [candlesData, headlines, vix, kiteData] = await Promise.all([
    getDualTimeframeCandles(ticker),
    getNews(symbol),
    getIndiaVix(),
    getOptionChain(symbol),
  ])

  const { candles15m, candles5m } = candlesData
  const { tf15m, tf5m } = analyzeDualTimeframe(candles15m, candles5m)
  const plan = generateTradePlan(tf15m, mode)
  const sentiment = await analyzeSentiment(headlines)

  const { quotes, finalOptions } = kiteData
  const optionsAnalysisZerodha = analyzeOptions(quotes, finalOptions, tf15m.price)
  
  const aiDecision = await analyzeWithAI({
    tf15m,
    tf5m,
    sentiment,
    optionsAnalysisZerodha,
    vix,
    mode,
    liveContext,
  })

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

  return { tf15m, tf5m, aiDecision }
}

program
  .command("analyze")
  .argument("<symbol>", "Symbol like NIFTY")
  .option("-m, --mode <mode>", "intraday | swing", "intraday")
  .action(async (symbol, options) => {
    await runAnalysis(symbol, options.mode)
  })

program
  .command("watch")
  .argument("<symbol>", "Symbol like NIFTY")
  .option("-m, --mode <mode>", "intraday | swing", "intraday")
  .action(async (symbol, options) => {
    const mode = options.mode as "intraday" | "swing"
    console.log(`\n🔭 Starting Watch Mode for ${symbol} (${mode})...`)

    // 1. Resolve Instrument Token
    const token = await getInstrumentToken(symbol)
    if (!token) {
      console.error(`❌ Could not find instrument token for ${symbol}`)
      return
    }
    console.log(`✅ Resolved ${symbol} to token ${token}`)

    // 2. Get Initial Levels
    const { tf15m } = await runAnalysis(symbol, mode)
    
    // 3. Setup Analyzer
    const analyzer = new LiveAnalyzer()
    analyzer.setLevels({
      resistance: tf15m.resistance,
      support: tf15m.support,
      vwap: tf15m.vwap
    })

    // 4. Setup Ticker
    const ticker = createTicker()
    
    ticker.on("ticks", (ticks: any[]) => {
      const targetTick = ticks.find(t => t.instrument_token === token)
      if (targetTick) {
        analyzer.addTick(targetTick)
        process.stdout.write(`\rLive: ${targetTick.last_price.toFixed(2)} | RSI: ${tf15m.rsi.toFixed(2)} | Trend: ${tf15m.trend} `)
      }
    })

    ticker.on("connect", () => {
      console.log("🟢 WebSocket Connected")
      ticker.subscribe([token])
      ticker.setMode(ticker.modeFull, [token])
    })

    ticker.on("error", (err: any) => {
      console.error("🔴 WebSocket Error:", err)
    })

    ticker.on("close", (reason: any) => {
      console.log("🟠 WebSocket Closed:", reason)
    })

    analyzer.on("breakout", async (context) => {
      console.log("\n" + "=".repeat(50))
      console.log("⚡ BREAKOUT DETECTED")
      await runAnalysis(symbol, mode, context)
      console.log("\n" + "=".repeat(50))
      console.log("🔭 Resuming Watch Mode...")
    })

    ticker.connect()
  })

program.parse()

