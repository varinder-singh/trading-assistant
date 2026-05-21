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

                await paperTrader.placeOrder({
                  symbol: option.symbol,
                  token: option.token,
                  side: "BUY",
                  quantity: 1,
                  price: entryPrice,
                  context: {
                    aiReasoning: decision.reason,
                    aiConfidence: decision.confidence,
                    vixLevel: vix.current,
                    rsiLevel: tf.rsi,
                    trend15m: tf.trend,
                    aiStopLoss: decision.stopLoss,
                    aiTarget: decision.targets && decision.targets.length > 0 ? decision.targets[0] : undefined
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
