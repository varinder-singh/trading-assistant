import { createTicker } from "@core/data/kite-ticker.js"
import { getInstrumentToken, getOptionToken } from "@core/data/kite.js"
import { LiveAnalyzer } from "@core/analysis/live.js"
import { paperTrader } from "@core/execution/paper-trader.js"
import { runAnalysis } from "@core/analysis/trade.js"
import kc from "@core/data/kite.js"

// Shared ticker instance
let globalTicker: any = null
const clients = new Map<string, { 
  peer: any, 
  analyzer: LiveAnalyzer, 
  symbol: string, 
  token: number,
  mode: "intraday" | "swing",
  lastDecision: any
}>()

// Listen to paper trader updates globally
paperTrader.on("portfolio_update", (positions) => {
  broadcast({ type: 'portfolio', data: positions })
})

paperTrader.on("pnl_update", (positions) => {
  broadcast({ type: 'portfolio', data: positions })
})

paperTrader.on("notification", (notif) => {
  broadcast({ type: 'notification', data: notif })
})

paperTrader.on("market_close", () => {
  console.log("[ws] Market Closed signal received. Stopping ticker.");
  if (globalTicker) {
    globalTicker.disconnect();
    globalTicker = null;
  }
  broadcast({ type: 'market_closed', message: 'Market hours ended (3:30 PM IST). Watching stopped.' });
})

function broadcast(msg: any) {
  const data = JSON.stringify(msg)
  for (const [id, client] of clients) {
    client.peer.send(data)
  }
}

function getTicker() {
  if (!globalTicker) {
    console.log('Initializing Global Kite Ticker...')
    globalTicker = createTicker()
    
    globalTicker.on("ticks", (ticks: any[]) => {
      // Route ticks to relevant clients
      for (const [id, client] of clients) {
        const tick = ticks.find(t => t.instrument_token === client.token)
        if (tick) {
          client.analyzer.addTick(tick)
          client.peer.send(JSON.stringify({
            type: 'tick',
            data: tick
          }))
        }
      }

      // Update paper trader prices
      ticks.forEach(tick => {
        paperTrader.updatePrice(tick.instrument_token, tick.last_price)
      })
    })

    globalTicker.on("connect", () => {
        console.log("Global WebSocket Connected")
        // Resubscribe all active tokens
        const tokens = Array.from(new Set(Array.from(clients.values()).map(c => c.token)))
        if (tokens.length > 0) {
            globalTicker.subscribe(tokens)
            globalTicker.setMode(globalTicker.modeFull, tokens)
        }
    })

    globalTicker.connect()
  }
  return globalTicker
}

export default defineWebSocketHandler({
  open(peer) {
    console.log(`[ws] open ${peer.id}`)
  },

  async message(peer, message) {
    const text = message.text()
    if (!text) return

    try {
      const msg = JSON.parse(text)
      
      if (msg.type === 'watch') {
        const { symbol, levels, mode } = msg.data
        const token = await getInstrumentToken(symbol)
        
        if (!token) {
          peer.send(JSON.stringify({ type: 'error', message: `Token not found for ${symbol}` }))
          return
        }

        const analyzer = new LiveAnalyzer()
        if (levels) {
          analyzer.setLevels(levels)
        }

        analyzer.on("breakout", async (context) => {
          const client = clients.get(peer.id)
          if (!client) return

          console.log(`[ws] Breakout detected for ${symbol}`)
          peer.send(JSON.stringify({ type: 'breakout', data: context }))

          try {
            const { tf15m: tf, aiDecision: decision, vix } = await runAnalysis(symbol, client.mode, context, client.lastDecision)
            client.lastDecision = decision

            // --- Paper Trading Execution ---
            if (decision.optionAction && decision.optionAction !== "NONE" && decision.strike) {
              const type = decision.optionAction === "BUY_CE" ? "CE" : "PE"
              const option = await getOptionToken(symbol, decision.strike, type)

              if (option) {
                console.log(`[ws] Executing Paper Trade for ${option.symbol}...`)
                const ticker = getTicker()
                ticker.subscribe([option.token])
                ticker.setMode(ticker.modeFull, [option.token])

                const quote = await kc.getQuote([`NFO:${option.symbol}`])
                const entryPrice = quote[`NFO:${option.symbol}`]?.last_price || 0

                // DYNAMIC RISK CALCULATION: Index Market Structure -> Option Premium
                // 1. Calculate Index Risk Points
                const indexPriceAtEntry = tf.price;
                const indexRiskPoints = Math.abs(indexPriceAtEntry - decision.indexStopLoss);
                
                // 2. Translate to Option Premium Risk using ATM Delta (~0.5)
                // If Nifty moves 100 points, ATM option premium moves roughly 50 points.
                const estimatedDelta = 0.5;
                const optionRiskPoints = indexRiskPoints * estimatedDelta;
                
                // 3. Calculate Final Premium Exit Levels
                const calculatedSl = entryPrice - optionRiskPoints;
                const calculatedTarget = entryPrice + (optionRiskPoints * (decision.riskRewardRatio || 1.5));

                console.log(`[ws] Risk Translation: Index Risk ${indexRiskPoints.toFixed(2)} pts -> Option Risk ${optionRiskPoints.toFixed(2)} pts`)
                console.log(`[ws] Option Entry: ${entryPrice}, Calculated SL: ${calculatedSl.toFixed(2)}, Target: ${calculatedTarget.toFixed(2)} (R:R ${decision.riskRewardRatio || 1.5})`)

                await paperTrader.placeOrder({
                  symbol: option.symbol,
                  token: option.token,
                  strike: decision.strike,
                  side: "BUY",
                  quantity: 1,
                  price: entryPrice,
                  context: {
                    aiReasoning: decision.reason,
                    aiConfidence: decision.confidence,
                    aiStrike: decision.strike,
                    aiSetup: decision.setup,
                    strategyContext: {
                      macroTrend: decision.macroTrend,
                      isCompression: tf.dailyContext?.isCompression,
                      atr14: tf.dailyContext?.atr14,
                      indexSl: decision.indexStopLoss
                    },
                    vixLevel: vix.current,
                    rsiLevel: tf.rsi,
                    trend15m: tf.trend,
                    aiStopLoss: calculatedSl,
                    aiTarget: calculatedTarget
                  }
                })
              }
            }
          } catch (err) {
            console.error(`[ws] Error during breakout analysis:`, err)
          }
        })

        clients.set(peer.id, {
          peer,
          analyzer,
          symbol,
          token,
          mode: mode || "intraday",
          lastDecision: null
        })

        const ticker = getTicker()
        ticker.subscribe([token])
        ticker.setMode(ticker.modeFull, [token])
        
        peer.send(JSON.stringify({ type: 'watching', symbol, token }))
        console.log(`[ws] client ${peer.id} watching ${symbol} (${token})`)
      }
    } catch (err) {
      console.error('[ws] error handling message', err)
    }
  },

  close(peer) {
    console.log(`[ws] close ${peer.id}`)
    clients.delete(peer.id)
    
    // Optional: unsubscribe from ticker if no more clients are watching that token
  },

  error(peer, error) {
    console.log(`[ws] error ${peer.id}`, error)
  }
})
