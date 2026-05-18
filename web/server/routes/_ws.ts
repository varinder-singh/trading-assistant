import { createTicker } from "@core/data/kite-ticker.js"
import { getInstrumentToken, getOptionToken } from "@core/data/kite.js"
import { LiveAnalyzer } from "@core/analysis/live.js"
import { paperTrader } from "@core/execution/paper-trader.js"

// Shared ticker instance
let globalTicker: any = null
const clients = new Map<string, { 
  peer: any, 
  analyzer: LiveAnalyzer, 
  symbol: string, 
  token: number 
}>()

// Listen to paper trader updates globally
paperTrader.on("portfolio_update", (positions) => {
  broadcast({ type: 'portfolio', data: positions })
})

paperTrader.on("pnl_update", (positions) => {
  broadcast({ type: 'portfolio', data: positions })
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
        const { symbol, levels } = msg.data
        const token = await getInstrumentToken(symbol)
        
        if (!token) {
          peer.send(JSON.stringify({ type: 'error', message: `Token not found for ${symbol}` }))
          return
        }

        const analyzer = new LiveAnalyzer()
        if (levels) {
          analyzer.setLevels(levels)
        }

        analyzer.on("breakout", (data) => {
          peer.send(JSON.stringify({
            type: 'breakout',
            data
          }))
        })

        clients.set(peer.id, {
          peer,
          analyzer,
          symbol,
          token
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
