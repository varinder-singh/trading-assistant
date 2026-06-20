import { UserSession } from "@core/execution/session-manager.js"
import { LiveAnalyzer } from "@core/analysis/live.js"

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
