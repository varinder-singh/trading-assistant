import { Command } from "commander"
import { runAnalysis } from "../analysis/trade.js"
import { getInstrumentToken, getOptionToken } from "../data/kite.js"
import { createTicker } from "../data/kite-ticker.js"
import { LiveAnalyzer } from "../analysis/live.js"
import { paperTrader } from "../execution/paper-trader.js"
import kc from "../data/kite.js"

export const watchCommand = new Command("watch")
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

    let lastDecision: any = null

    // 2. Get Initial Levels
    const { tf15m, aiDecision } = await runAnalysis(symbol, mode)
    lastDecision = aiDecision
    
    // 3. Setup Analyzer
    const analyzer = new LiveAnalyzer()
    analyzer.setLevels({
      resistance: tf15m.resistance,
      support: tf15m.support,
      vwap: tf15m.vwap
    })

    // 4. Setup Ticker
    const ticker = createTicker()

    paperTrader.on("market_close", () => {
      console.log("\n🛑 Market closed (3:30 PM IST). Stopping watch mode.")
      ticker.disconnect()
      process.exit(0)
    })
    
    ticker.on("ticks", (ticks: any[]) => {
      const targetTick = ticks.find(t => t.instrument_token === token)
      if (targetTick) {
        analyzer.addTick(targetTick)
        process.stdout.write(`\rLive: ${targetTick.last_price.toFixed(2)} | RSI: ${tf15m.rsi.toFixed(2)} | Trend: ${tf15m.trend} `)
      }

      // Update paper positions price
      ticks.forEach(tick => {
        paperTrader.updatePrice(tick.instrument_token, tick.last_price)
      })
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
      const { tf15m: tf, aiDecision: decision, vix, sentiment } = await runAnalysis(symbol, mode, context, lastDecision)
      lastDecision = decision

      // --- Paper Trading Execution ---
      if (lastDecision.optionAction && lastDecision.optionAction !== "NONE" && lastDecision.strike) {
        const type = lastDecision.optionAction === "BUY_CE" ? "CE" : "PE"
        const option = await getOptionToken(symbol, lastDecision.strike, type)

        if (option) {
          console.log(`📝 Executing Paper Trade for ${option.symbol}...`)

          // Subscribe ticker to the option
          ticker.subscribe([option.token])
          ticker.setMode(ticker.modeFull, [option.token])

          // Get current price for entry
          const quote = await kc.getQuote([`NFO:${option.symbol}`])
          const entryPrice = quote[`NFO:${option.symbol}`]?.last_price || 0

          await paperTrader.placeOrder({
            symbol: option.symbol,
            token: option.token,
            side: "BUY",
            quantity: 1, // Default to 1 lot for safety
            price: entryPrice,
            context: {
                aiReasoning: lastDecision.reason,
                aiConfidence: lastDecision.confidence,
                vixLevel: vix.current,
                rsiLevel: tf.rsi,
                trend15m: tf.trend,
                aiStopLoss: lastDecision.stopLoss,
                aiTarget: lastDecision.targets && lastDecision.targets.length > 0 ? lastDecision.targets[0] : undefined
            }
          })
        }
      }
      // -------------------------------

      console.log("\n" + "=".repeat(50))
      console.log("🔭 Resuming Watch Mode...")
    })

    ticker.connect()
  })
