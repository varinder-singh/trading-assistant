import { EventEmitter } from 'node:events'
import { PaperTrader } from './paper-trader.js'
import { createTicker } from '../data/kite-ticker.js'
import { createKiteClient } from '../data/kite.js'
import type { Connect as KiteConnect } from 'kiteconnect'

export class UserSession extends EventEmitter {
  public userId: string
  public accessToken: string
  public apiKey: string | undefined
  public kc: KiteConnect
  public ticker: ReturnType<typeof createTicker>
  public paperTrader: PaperTrader

  constructor(userId: string, accessToken: string, apiKey?: string, tradeMode: 'PAPER' | 'REAL' = 'PAPER') {
    super()
    this.userId = userId
    this.accessToken = accessToken
    this.apiKey = apiKey
    this.kc = createKiteClient(accessToken, apiKey)
    this.ticker = createTicker(accessToken, apiKey)
    this.paperTrader = new PaperTrader(userId, this.kc)
    this.paperTrader.setTradeMode(tradeMode)
  }

  async initialize() {
    await this.paperTrader.initialize()
    this.setupTickerListeners()
    this.ticker.connect()
  }

  private setupTickerListeners() {
    this.ticker.on('ticks', (ticks: any[]) => {
      ticks.forEach((tick) => {
        this.paperTrader.updatePrice(tick.instrument_token, tick.last_price)
      })
      this.emit('ticks', ticks)
    })

    this.ticker.on('connect', () => {
      console.log(`[SessionManager] Ticker connected for user ${this.userId}`)
      const positionTokens = this.paperTrader.getAllPositions().map((p) => p.token)
      if (positionTokens.length > 0) {
        this.ticker.subscribe(positionTokens)
        this.ticker.setMode(this.ticker.modeFull, positionTokens)
      }
      this.emit('connect')
    })

    this.ticker.on('error', (err: any) => {
      console.error(`[SessionManager] Ticker error for user ${this.userId}:`, err)
      this.emit('ticker_error', err)
    })

    this.ticker.on('close', (reason: any) => {
      console.warn(`[SessionManager] Ticker closed for user ${this.userId}:`, reason)
      this.emit('ticker_close', reason)
    })
  }

  updateToken(accessToken: string, apiKey?: string) {
    if (this.accessToken === accessToken && this.apiKey === apiKey) {
      return
    }

    console.log(`[UserSession] Token refreshed for user ${this.userId}. Re-initializing client and ticker.`)
    this.accessToken = accessToken
    this.apiKey = apiKey

    // Recreate KiteConnect client and pass to PaperTrader
    this.kc = createKiteClient(accessToken, apiKey)
    this.paperTrader.setKiteClient(this.kc)

    // Clean up old ticker instance
    try {
      this.ticker.disconnect()
      if (typeof (this.ticker as any).removeAllListeners === 'function') {
        ;(this.ticker as any).removeAllListeners()
      }
    } catch (err) {
      console.warn(`[UserSession] Error cleaning up old ticker for ${this.userId}:`, err)
    }

    // Recreate and reconnect ticker
    this.ticker = createTicker(accessToken, apiKey)
    this.setupTickerListeners()
    this.ticker.connect()

    // Emit event so other layers (e.g. websocket connections) can re-bind
    this.emit('ticker_recreated')
  }

  destroy() {
    try {
      this.ticker.disconnect()
      if (typeof (this.ticker as any).removeAllListeners === 'function') {
        ;(this.ticker as any).removeAllListeners()
      }
    } catch (err) {
      console.warn(`[UserSession] Error during ticker disconnect:`, err)
    }
    this.paperTrader.removeAllListeners()
    this.removeAllListeners()
  }
}

class SessionManager {
  private sessions = new Map<string, UserSession>()

  async getSession(
    userId: string,
    accessToken: string,
    apiKey: string,
    tradeMode: 'PAPER' | 'REAL' = 'PAPER'
  ): Promise<UserSession> {
    if (this.sessions.has(userId)) {
      const session = this.sessions.get(userId)!
      session.paperTrader.setTradeMode(tradeMode)
      session.updateToken(accessToken, apiKey)
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
