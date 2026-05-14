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

program
  .command("analyze")
  .argument("<symbol>", "Symbol like NIFTY")
  .option("-m, --mode <mode>", "intraday | swing", "intraday")
  .action(async (symbol, options) => {
    const ticker = symbol === "NIFTY" ? "^NSEI" : symbol === "BANKNIFTY" ? "^NSEBANK" : symbol
    const mode = options.mode as "intraday" | "swing"

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
    })

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
    console.log(`Instrument: ${aiDecision.instrument ?? "N/A"}`)
    console.log(`Option Action: ${aiDecision.optionAction ?? "N/A"}`)
    console.log(`Strike: ${aiDecision.strike ?? "N/A"}`)
    console.log(`Reason: ${aiDecision.reason}`)
    console.log(`Confidence: ${aiDecision.confidence}`)
    console.log(`Entry: ${aiDecision.entry}`)
    console.log(`SL: ${aiDecision.stopLoss}`)
    console.log(`Targets: ${aiDecision.targets?.join(", ")}`)
    console.log(`RR: ${aiDecision.riskReward ?? "N/A"}`)

    logSection("📊 Dual Timeframe Analysis")
    console.log(`\n⚙️ Mode: ${mode.toUpperCase()}`)
    console.log(`Current Price: ${tf15m.price}`)

    logSubsection("⏱️ 15-Minute (Trend Confirmation)")
    console.log(`Trend: ${tf15m.trend}`)
    console.log(`VWAP: ${tf15m.vwap.toFixed(2)} (${tf15m.vwapPosition})`)
    console.log(`Resistance: ${tf15m.resistance.toFixed(2)}`)
    console.log(`Support: ${tf15m.support.toFixed(2)}`)
    console.log(`RSI: ${tf15m.rsi.toFixed(2)}`)

    logSubsection("⚡ 5-Minute (Entry Precision)")
    console.log(`Resistance: ${tf5m.resistance.toFixed(2)}`)
    console.log(`Support: ${tf5m.support.toFixed(2)}`)
    console.log(`RSI: ${tf5m.rsi.toFixed(2)}`)

    logSubsection("🧠 Rule-Based Trade Plan (15m)")
    console.log(`Mode: ${mode}`)
    console.log(`Decision: ${plan.decision}`)
    console.log(`Reason: ${plan.reason}`)


    logSection("📊 Zerodha Options Analysis")
    for (const line of formatOptionsAnalysisForLog(optionsAnalysisZerodha)) {
      console.log(line)
    }

    if (
      tf15m.trend === "bullish" &&
      tf15m.vwapPosition === "above"
    ) {
      console.log("\n👉 Trend Bias: BUY on dips")
    } else if (
      tf15m.trend === "bearish" &&
      tf15m.vwapPosition === "below"
    ) {
      console.log("\n👉 Trend Bias: SELL on rise")
    } else {
      console.log("\n👉 Trend Bias: NO TRADE (sideways)")
    }

    if (plan.entry) {
      console.log(`Entry: ${plan.entry}`)
      console.log(`Stop Loss: ${plan.stopLoss}`)
      console.log(`Target: ${plan.targets?.join(", ")}`)
      console.log(`RR: ${plan.riskReward}`)
    }
  })

program.parse()

