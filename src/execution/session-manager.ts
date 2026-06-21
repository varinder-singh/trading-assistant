import { PaperTrader } from "./paper-trader.js"
import { createTicker } from "../data/kite-ticker.js"
import { createKiteClient } from "../data/kite.js"
import type { Connect as KiteConnect } from "kiteconnect"

export class UserSession {
  public userId: string
  public kc: KiteConnect
  public ticker: ReturnType<typeof createTicker>
  public paperTrader: PaperTrader

  constructor(userId: string, accessToken: string, apiKey?: string, tradeMode: "PAPER" | "REAL" = "PAPER") {
    this.userId = userId
    this.kc = createKiteClient(accessToken, apiKey)
    this.ticker = createTicker(accessToken, apiKey)
    this.paperTrader = new PaperTrader(userId, this.kc)
    this.paperTrader.setTradeMode(tradeMode)
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

  async getSession(userId: string, accessToken: string, apiKey?: string, tradeMode: "PAPER" | "REAL" = "PAPER"): Promise<UserSession> {
    if (this.sessions.has(userId)) {
      const session = this.sessions.get(userId)!
      session.paperTrader.setTradeMode(tradeMode)
      return session
    }

    const session = new UserSession(userId, accessToken, apiKey, tradeMode)
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

  getExistingSession(userId: string): UserSession | undefined {
    return this.sessions.get(userId)
  }
}

export const sessionManager = new SessionManager()
