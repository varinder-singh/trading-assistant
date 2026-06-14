import { PaperTrader } from "./paper-trader.js"
import { createTicker } from "../data/kite-ticker.js"
import { createKiteClient } from "../data/kite.js"
import type { KiteTicker, KiteConnect } from "kiteconnect"

export class UserSession {
  userId: string
  kc: any
  ticker: any
  paperTrader: PaperTrader

  constructor(userId: string, accessToken: string) {
    this.userId = userId
    this.kc = createKiteClient(accessToken)
    this.ticker = createTicker(accessToken)
    this.paperTrader = new PaperTrader(userId, this.kc)
  }

  async initialize() {
    await this.paperTrader.initialize()
    
    this.ticker.on("ticks", (ticks: any[]) => {
      ticks.forEach((tick) => {
        this.paperTrader.updatePrice(tick.instrument_token, tick.last_price)
      })
    })

    this.ticker.on("connect", () => {
      console.log(`[SessionManager] Ticker connected for user ${this.userId}`)
      const positionTokens = this.paperTrader.getAllPositions().map((p) => p.token)
      if (positionTokens.length > 0) {
        this.ticker.subscribe(positionTokens)
        this.ticker.setMode(this.ticker.modeFull, positionTokens)
      }
    })

    this.ticker.on("error", (err: any) => {
      console.error(`[SessionManager] Ticker error for user ${this.userId}:`, err)
    })

    this.ticker.on("close", (reason: any) => {
      console.warn(`[SessionManager] Ticker closed for user ${this.userId}:`, reason)
    })

    this.ticker.connect()
  }

  destroy() {
    this.ticker.disconnect()
    this.paperTrader.removeAllListeners()
  }
}

class SessionManager {
  private sessions = new Map<string, UserSession>()

  async getSession(userId: string, accessToken: string): Promise<UserSession> {
    if (this.sessions.has(userId)) {
      return this.sessions.get(userId)!
    }

    const session = new UserSession(userId, accessToken)
    await session.initialize()
    this.sessions.set(userId, session)
    return session
  }

  removeSession(userId: string) {
    const session = this.sessions.get(userId)
    if (session) {
      session.destroy()
      this.sessions.delete(userId)
    }
  }
}

export const sessionManager = new SessionManager()
