import { UserSession } from "@core/execution/session-manager.js"
import { LiveAnalyzer } from "@core/analysis/live.js"
import { eventHub } from "@core/utils/event-hub.js"
import { candleBuilder } from "@core/data/candle-builder.js"
import { gtiTracker } from "@core/indicators/gti-tracker.js"
import { gtiRepo } from "@core/db/repositories/gti-repo.js"

export interface WsClientState {
  peer: any
  userId: string
  session: UserSession
  analyzer: LiveAnalyzer
  symbol: string
  token: number
  mode: "intraday" | "swing"
  lastDecision: any
  chartTimeframe: number
  isAnalyzing?: boolean
}

class WsConnectionManager {
  private clients = new Map<string, WsClientState>()
  private listenersInitialized = false

  setupGlobalListeners() {
    if (this.listenersInitialized) return
    this.listenersInitialized = true

    eventHub.on("agent_update", (update) => {
      // If the update has a userId, broadcast only to that user for privacy
      if (update.userId) {
        this.broadcastToUser(update.userId, { type: "agent_update", data: update })
      } else {
        this.broadcastAll({ type: "agent_update", data: update })
      }
    })

    // Global CandleBuilder close listener for GTI
    candleBuilder.on("candle_close", async ({ token, timeframe, candle }) => {
      const gtiScore = gtiTracker.onCandleClose(token, candle)

      const clients = this.getAllClients()
      // Persist to DB
      const symbol = clients.find((c) => c.token === token)?.symbol || `TOKEN_${token}`
      try {
        await gtiRepo.saveScore({
          symbol,
          token,
          timeframe,
          candleTime: candle.time,
          candle,
          gtiScore,
        })
      } catch (err) {
        console.error(`[GTI] Failed to persist score for ${symbol}:`, err)
      }

      // Route to relevant clients
      for (const client of clients) {
        if (client.token === token) {
          client.analyzer.updateGTI(gtiScore)
        }
      }
    })
  }

  addClient(peerId: string, state: WsClientState) {
    this.clients.set(peerId, state)
  }

  getClient(peerId: string): WsClientState | undefined {
    return this.clients.get(peerId)
  }

  removeClient(peerId: string) {
    this.clients.delete(peerId)
  }

  getAllClients(): WsClientState[] {
    return Array.from(this.clients.values())
  }

  broadcastToUser(userId: string, msg: any) {
    const data = JSON.stringify(msg)
    for (const client of this.clients.values()) {
      if (client.userId === userId) {
        client.peer.send(data)
      }
    }
  }

  // NOTE: This broadcasts to ALL connected users. Use cautiously.
  broadcastAll(msg: any) {
    const data = JSON.stringify(msg)
    for (const client of this.clients.values()) {
      client.peer.send(data)
    }
  }
}

export const wsConnectionManager = new WsConnectionManager()
