import { eventHub } from '@core/utils/event-hub.js'
import type { ClientConnection } from './client-connection.js'

/**
 * WsConnectionManager: Tracks active browser WebSocket connections.
 *
 * NOTE: Analysis, tick routing, and GTI processing now live in UserSession.
 * This class only manages browser connections for UI broadcasting.
 */
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
