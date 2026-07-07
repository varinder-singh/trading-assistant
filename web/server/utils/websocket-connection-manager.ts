import { eventHub } from '@core/utils/event-hub.js'
import { candleBuilder } from '@core/data/candle-builder.js'
import { gtiTracker } from '@core/indicators/gti-tracker.js'
import { gtiRepo } from '@core/db/repositories/container.js'
import type { ClientConnection } from './client-connection.js'

class WsConnectionManager {
  private clients = new Map<string, ClientConnection>()
  private listenersInitialized = false

  setupGlobalListeners() {
    if (this.listenersInitialized) return
    this.listenersInitialized = true

    eventHub.on('agent_update', (update) => {
      // If the update has a userId, broadcast only to that user for privacy
      if (update.userId) {
        this.broadcastToUser(update.userId, { type: 'agent_update', data: update })
      } else {
        this.broadcastAll({ type: 'agent_update', data: update })
      }
    })

    // Global CandleBuilder close listener for GTI
    candleBuilder.on('candle_close', async ({ token, timeframe, candle }) => {
      const gtiScore = gtiTracker.onCandleClose(token, candle)

      const clients = this.getAllClients()
      // Persist to DB
      const symbol = clients.find((c) => c.token === token)?.symbol || `TOKEN_${token}`
      try {
        await gtiRepo.saveScore({
          symbol,
          token,
          timeframe,
          candleTime: candle.timestamp,
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

  addClient(peerId: string, client: ClientConnection) {
    this.clients.set(peerId, client)
  }

  getClient(peerId: string): ClientConnection | undefined {
    return this.clients.get(peerId)
  }

  removeClient(peerId: string) {
    const client = this.clients.get(peerId)
    if (client) {
      client.destroy()
      this.clients.delete(peerId)
    }
  }

  getAllClients(): ClientConnection[] {
    return Array.from(this.clients.values())
  }

  broadcastToUser(userId: string, msg: any) {
    for (const client of this.clients.values()) {
      if (client.userId === userId) {
        client.send(msg)
      }
    }
  }

  // NOTE: This broadcasts to ALL connected users. Use cautiously.
  broadcastAll(msg: any) {
    for (const client of this.clients.values()) {
      client.send(msg)
    }
  }
}

export const wsConnectionManager = new WsConnectionManager()
