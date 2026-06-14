import { getInstrumentToken, getOptionToken } from "@core/data/kite.js"
import { LiveAnalyzer } from "@core/analysis/live.js"
import { runAnalysis } from "@core/analysis/trade.js"
import { eventHub } from "@core/utils/event-hub.js"
import { eventRepo } from "@core/db/repositories/event-repo.js"
import { candleBuilder } from "@core/data/candle-builder.js"
import { getIntradayBaseline } from "@core/data/kite-historical.js"
import { gtiTracker } from "@core/indicators/gti-tracker.js"
import { gtiRepo } from "@core/db/repositories/gti-repo.js"
import { sessionManager, UserSession } from "@core/execution/session-manager.js"
import { db } from "@core/db/database.js"
import { isMarketOpen } from "@core/utils/market-hours.js"
import { AIMacroTrend } from "@core/types/analysis.js"

/**
 * Seed CandleBuilder for a specific token if not already seeded.
 */
async function seedCandleBuilder(kc: any, token: number) {
  if (candleBuilder.isSeeded(token)) return

  console.log(`📊 Seeding CandleBuilder for token ${token}...`)
  try {
    const [c1m, c3m, c15m, c30m] = await Promise.all([
      getIntradayBaseline(kc, token, "minute", 2),
      getIntradayBaseline(kc, token, "3minute", 5),
      getIntradayBaseline(kc, token, "15minute", 5),
      getIntradayBaseline(kc, token, "30minute", 5),
    ])
    candleBuilder.seed(token, 1, c1m)
    candleBuilder.seed(token, 3, c3m)
    candleBuilder.seed(token, 15, c15m)
    candleBuilder.seed(token, 30, c30m)
    console.log(`✅ CandleBuilder seeded for token ${token}.`)
  } catch (err) {
    console.error(`❌ Failed to seed CandleBuilder for token ${token}:`, err)
  }
}

// Map from Peer ID -> Client State
const clients = new Map<
  string,
  {
    peer: any
    userId: string
    session: UserSession
    analyzer: LiveAnalyzer
    symbol: string
    token: number
    mode: "intraday" | "swing"
    lastDecision: any
    chartTimeframe: number
  }
>()

function broadcastToUser(userId: string, msg: any) {
  const data = JSON.stringify(msg)
  for (const client of clients.values()) {
    if (client.userId === userId) {
      client.peer.send(data)
    }
  }
}

function broadcastAll(msg: any) {
  const data = JSON.stringify(msg)
  for (const client of clients.values()) {
    client.peer.send(data)
  }
}

eventHub.on("agent_update", (update) => {
  broadcastAll({ type: "agent_update", data: update })
})

// Global CandleBuilder close listener for GTI
candleBuilder.on("candle_close", async ({ token, timeframe, candle }) => {
  const gtiScore = gtiTracker.onCandleClose(token, candle)
  
  // Persist to DB
  const symbol = Array.from(clients.values()).find(c => c.token === token)?.symbol || `TOKEN_${token}`
  try {
    await gtiRepo.saveScore({
      symbol,
      token,
      timeframe,
      candleTime: candle.time,
      candle,
      gtiScore
    })
  } catch (err) {
    console.error(`[GTI] Failed to persist score for ${symbol}:`, err)
  }

  // Route to relevant clients
  for (const client of clients.values()) {
    if (client.token === token) {
      client.analyzer.updateGTI(gtiScore)
    }
  }
})

function decodeJwtBase64(token: string) {
  try {
    const base64Url = token.split('.')[1]
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/')
    const jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)
    }).join(''))
    return JSON.parse(jsonPayload)
  } catch (e) {
    return null
  }
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

      // 1. AUTHENTICATION
      if (msg.type === "auth") {
        const payload = decodeJwtBase64(msg.token)
        if (!payload || !payload.sub) {
          peer.send(JSON.stringify({ type: "error", message: "Invalid JWT token" }))
          return
        }

        const userId = payload.sub

        const brokerAccount = await db.selectFrom('brokerAccounts')
          .select('accessToken')
          .where('userId', '=', userId)
          .where('isActive', '=', true)
          .executeTakeFirst()

        if (!brokerAccount?.accessToken) {
          peer.send(JSON.stringify({ type: "error", message: "Zerodha account not linked." }))
          return
        }

        // Initialize User Session
        const session = await sessionManager.getSession(userId, brokerAccount.accessToken)

        // Setup event listeners for this user's paper trader
        session.paperTrader.on("portfolio_update", (positions) => {
          broadcastToUser(userId, { type: "portfolio", data: positions })
        })
        session.paperTrader.on("pnl_update", (positions) => {
          broadcastToUser(userId, { type: "portfolio", data: positions })
        })
        session.paperTrader.on("notification", (notif) => {
          broadcastToUser(userId, { type: "notification", data: notif })
        })

        // Hook up tick routing to LiveAnalyzer
        session.ticker.on("ticks", (ticks: any[]) => {
          for (const client of clients.values()) {
            if (client.userId === userId) {
              const tick = ticks.find((t) => t.instrument_token === client.token)
              if (tick) {
                client.analyzer.addTick(tick)
                const currentGTI = gtiTracker.getCurrentScore(client.token)
                client.peer.send(
                  JSON.stringify({
                    type: "tick",
                    data: { ...tick, gtiScore: currentGTI },
                  })
                )
              }
            }
          }

          // Also update candle builder globally
          ticks.forEach((tick) => {
            candleBuilder.addTick(tick)
            gtiTracker.addTick(tick)
          })
        })

        // Store temporary uninitialized client mapping
        clients.set(peer.id, {
          peer,
          userId,
          session,
          analyzer: new LiveAnalyzer(), // dummy
          symbol: "",
          token: 0,
          mode: "intraday",
          lastDecision: null,
          chartTimeframe: 15
        })

        peer.send(JSON.stringify({ type: "authenticated" }))
        console.log(`[ws] User ${userId} authenticated on peer ${peer.id}`)
        return
      }

      // 2. WATCH COMMAND
      if (msg.type === "watch") {
        const client = clients.get(peer.id)
        if (!client || !client.userId) {
          peer.send(JSON.stringify({ type: "error", message: "Not authenticated" }))
          return
        }

        const { symbol, levels, mode } = msg.data
        const token = await getInstrumentToken(client.session.kc, symbol)

        if (!token) {
          peer.send(JSON.stringify({ type: "error", message: `Token not found for ${symbol}` }))
          return
        }

        await seedCandleBuilder(client.session.kc, token)

        const analyzer = new LiveAnalyzer()

        if (!isMarketOpen()) {
          peer.send(JSON.stringify({ type: "market_closed", message: "Market is closed. Operating in read-only mode." }))
        } else if (levels) {
          analyzer.setLevels(levels)

          analyzer.on("breakout", async (context) => {
            console.log(`[ws] Breakout detected for ${symbol}`)
            peer.send(JSON.stringify({ type: "breakout", data: context }))

            await eventRepo.saveEvent({
              symbol,
              reason: context.reason,
              price: context.tick.last_price,
              timestamp: new Date().toISOString(),
              metadata: { tick: context.tick },
            })

            try {
              const analysisResult = await runAnalysis(client.session.kc, symbol, client.mode, context, client.lastDecision)
              const { tf15m: tf, aiDecision: decision, vix, agentType } = analysisResult
              client.lastDecision = decision

              peer.send(JSON.stringify({ type: "analysis", data: analysisResult }))

              if (decision && decision.optionAction !== "NONE") {
                const type = decision.optionAction === "BUY_CE" ? "CE" : "PE"
                const option = await getOptionToken(client.session.kc, symbol, decision.strike || 0, type)

                if (option) {
                  console.log(`[ws] Executing Paper Trade for ${option.symbol} (${agentType} Agent)...`)
                  client.session.ticker.subscribe([option.token])
                  client.session.ticker.setMode(client.session.ticker.modeFull, [option.token])

                  const quote = await client.session.kc.getQuote([`NFO:${option.symbol}`])
                  const entryPrice = quote[`NFO:${option.symbol}`]?.last_price || 0

                  if (entryPrice > 0) {
                    const indexRiskPoints = Math.abs(tf.price - decision.stopLoss)
                    const estimatedDelta = 0.5
                    const optionRiskPoints = indexRiskPoints * estimatedDelta

                    let calculatedSl = entryPrice - optionRiskPoints
                    const calculatedTarget = entryPrice + optionRiskPoints * (decision.riskRewardRatio || 1.5)
                    
                    const floorPercentage = agentType === "TREND" ? 0 : 0.2
                    const minAllowedSl = Math.max(entryPrice * floorPercentage, 0.05)
                    if (calculatedSl < minAllowedSl) calculatedSl = minAllowedSl

                    await client.session.paperTrader.placeOrder({
                      symbol: option.symbol,
                      token: option.token,
                      strike: decision.strike || undefined,
                      side: "BUY",
                      quantity: 1,
                      price: entryPrice,
                      context: {
                        aiReasoning: decision.reason,
                        aiConfidence: decision.confidence,
                        aiStrike: decision.strike || undefined,
                        aiSetup: decision.setup,
                        strategyContext: { macroTrend: decision.macroTrend as AIMacroTrend, indexSl: decision.stopLoss, agentType },
                        vixLevel: vix.current,
                        rsiLevel: tf.rsi,
                        trend15m: tf.trend,
                        aiStopLoss: calculatedSl,
                        aiTarget: calculatedTarget,
                      },
                    })
                  }
                }
              }
            } catch (err) {
              console.error(`[ws] Error during breakout analysis:`, err)
            }
          })
        }

        client.analyzer = analyzer
        client.symbol = symbol
        client.token = token
        client.mode = mode || "intraday"
        client.chartTimeframe = msg.data.chartTimeframe || 1

        const positionTokens = client.session.paperTrader.getAllPositions().map((p) => p.token).filter(t => !!t)
        const tokensToSubscribe = Array.from(new Set([token, ...positionTokens]))

        client.session.ticker.subscribe(tokensToSubscribe)
        client.session.ticker.setMode(client.session.ticker.modeFull, tokensToSubscribe)

        peer.send(JSON.stringify({ type: "watching", symbol, token }))
        peer.send(JSON.stringify({ type: "portfolio", data: client.session.paperTrader.getAllPositions() }))
      }
    } catch (err) {
      console.error("[ws] error handling message", err)
    }
  },

  close(peer) {
    console.log(`[ws] close ${peer.id}`)
    clients.delete(peer.id)
  },

  error(peer, error) {
    console.log(`[ws] error ${peer.id}`, error)
  },
})
