import { createClient } from "@supabase/supabase-js"
import { sessionManager } from "@core/execution/session-manager.js"
import { db } from "@core/db/database.js"
import { decryptSecret } from "@core/utils/crypto.js"
import { LiveAnalyzer } from "@core/analysis/live.js"
import { gtiTracker } from "@core/indicators/gti-tracker.js"
import { candleBuilder } from "@core/data/candle-builder.js"
import { wsConnectionManager } from "./websocket-connection-manager.js"

// Initialize Supabase client for JWT verification
const supabaseUrl = process.env.SUPABASE_URL || ""
const supabaseKey = process.env.SUPABASE_KEY || ""
const supabase = createClient(supabaseUrl, supabaseKey)

export async function handleAuthCommand(peer: any, msg: any) {
  // SECURE JWT VERIFICATION: Use Supabase to verify the signature and ensure it hasn't expired/been revoked
  const { data: { user }, error } = await supabase.auth.getUser(msg.token)
  if (error || !user) {
    peer.send(JSON.stringify({ type: "error", message: "Invalid or expired JWT token" }))
    return
  }

  const userId = user.id

  const brokerAccount = await db
    .selectFrom("brokerAccounts")
    .select(["accessToken", "apiKey"])
    .where("userId", "=", userId)
    .where("isActive", "=", true)
    .executeTakeFirst()

  if (!brokerAccount?.accessToken) {
    peer.send(JSON.stringify({ type: "error", message: "Zerodha account not linked." }))
    return
  }

  // Initialize User Session
  const session = await sessionManager.getSession(userId, decryptSecret(brokerAccount.accessToken), brokerAccount.apiKey || undefined)

  // Setup event listeners for this user's paper trader
  session.paperTrader.on("portfolio_update", (positions) => {
    wsConnectionManager.broadcastToUser(userId, { type: "portfolio", data: positions })
  })
  session.paperTrader.on("pnl_update", (positions) => {
    wsConnectionManager.broadcastToUser(userId, { type: "portfolio", data: positions })
  })
  session.paperTrader.on("notification", (notif) => {
    wsConnectionManager.broadcastToUser(userId, { type: "notification", data: notif })
  })

  // Hook up tick routing to LiveAnalyzer
  session.ticker.on("ticks", (ticks: any[]) => {
    const clients = wsConnectionManager.getAllClients()
    for (const client of clients) {
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
  wsConnectionManager.addClient(peer.id, {
    peer,
    userId,
    session,
    analyzer: new LiveAnalyzer(), // dummy
    symbol: "",
    token: 0,
    mode: "intraday",
    lastDecision: null,
    chartTimeframe: 15,
  })

  peer.send(JSON.stringify({ type: "authenticated" }))
  console.log(`[ws] User ${userId} authenticated on peer ${peer.id}`)
}
