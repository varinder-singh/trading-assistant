import { createClient } from '@supabase/supabase-js'
import { sessionManager, UserSession } from '@core/execution/session-manager.js'
import { userRepo } from '@core/db/repositories/container.js'
import { decryptSecret } from '@core/utils/crypto.js'
import { gtiTracker } from '@core/indicators/gti-tracker.js'
import { wsConnectionManager } from './websocket-connection-manager.js'

// Initialize Supabase client for JWT verification
const supabaseUrl = process.env.SUPABASE_URL || ''
const supabaseKey = process.env.SUPABASE_KEY || ''
const supabase = createClient(supabaseUrl, supabaseKey)

/**
 * ClientConnection is a thin UI relay.
 *
 * All analysis logic (LiveAnalyzer, breakout detection, trade execution)
 * lives in UserSession and runs server-side, independent of browser state.
 * This class only relays session events to/from the browser WebSocket.
 */
export class ClientConnection {
  public id: string
  public peer: any
  public userId?: string
  public session?: UserSession
  public chartTimeframe: number = 15

  // ── UI Relay Handlers ────────────────────────────────────────────────
  private onPortfolioUpdate = (positions: any) => {
    this.send({ type: 'portfolio', data: positions })
  }

  private onPnlUpdate = (positions: any) => {
    this.send({ type: 'portfolio', data: positions })
  }

  private onNotification = (notif: any) => {
    this.send({ type: 'notification', data: notif })
  }

  private onTicks = (ticks: any[]) => {
    if (!this.session || !this.session.watchedToken) return

    const tick = ticks.find((t) => t.instrument_token === this.session!.watchedToken)
    if (tick) {
      const currentGTI = gtiTracker.getCurrentScore(this.session!.watchedToken)
      this.send({
        type: 'tick',
        data: { ...tick, gtiScore: currentGTI },
      })
    }
  }

  private onTokenExpired = (data: any) => {
    this.send({ type: 'error', message: data.message })
  }

  private onBreakout = (context: any) => {
    this.send({ type: 'breakout', data: context })
  }

  private onAnalysis = (result: any) => {
    this.send({ type: 'analysis', data: result })
  }

  private onWatching = ({ symbol, token }: { symbol: string; token: number }) => {
    this.send({ type: 'watching', symbol, token })
  }

  private onPortfolioSync = (positions: any) => {
    this.send({ type: 'portfolio', data: positions })
  }

  private onMarketClosed = (data: any) => {
    this.send({ type: 'market_closed', message: data.message })
  }

  private onWatchError = (data: any) => {
    this.send({ type: 'error', message: data.message })
  }

  constructor(peer: any) {
    this.peer = peer
    this.id = peer.id
  }

  public send(msg: any) {
    try {
      this.peer.send(JSON.stringify(msg))
    } catch (err) {
      console.error(`[ClientConnection] Failed to send message to peer ${this.id}:`, err)
    }
  }

  public async handleMessage(text: string) {
    try {
      const msg = JSON.parse(text)
      if (msg.type === 'auth') {
        await this.handleAuth(msg.token)
      } else if (msg.type === 'watch') {
        await this.handleWatch(msg.data)
      }
    } catch (err) {
      console.error(`[ClientConnection] Error handling message on peer ${this.id}:`, err)
    }
  }

  private async handleAuth(token: string) {
    // SECURE JWT VERIFICATION: Use Supabase to verify the signature and ensure it hasn't expired/been revoked
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser(token)
    if (error || !user) {
      this.send({ type: 'error', message: 'Invalid or expired JWT token' })
      return
    }

    const userId = user.id
    this.userId = userId

    const profile = await userRepo.getUserProfileByUserId(userId)
    const tradeMode = profile?.tradeMode || 'PAPER'

    const brokerAccount = await userRepo.getUserBrokerAccountByUserId(userId)

    if (!brokerAccount?.apiKey || !brokerAccount?.accessToken) {
      this.send({ type: 'error', message: 'Zerodha account is not linked with user account.' })
      return
    }

    // Initialize User Session
    const session = await sessionManager.getSession(
      userId,
      decryptSecret(brokerAccount.accessToken),
      brokerAccount.apiKey,
      tradeMode
    )

    this.session = session

    // Cleanup any existing session listeners if re-authenticating
    this.cleanupSessionListeners()

    // Register UI relay listeners on session
    session.paperTrader.on('portfolio_update', this.onPortfolioUpdate)
    session.paperTrader.on('pnl_update', this.onPnlUpdate)
    session.paperTrader.on('notification', this.onNotification)
    session.on('ticks', this.onTicks)
    session.on('breakout', this.onBreakout)
    session.on('analysis', this.onAnalysis)
    session.on('watching', this.onWatching)
    session.on('portfolio_sync', this.onPortfolioSync)
    session.on('market_closed', this.onMarketClosed)
    session.on('watch_error', this.onWatchError)
    session.on('token_expired', this.onTokenExpired)

    // Update connection status in wsConnectionManager
    wsConnectionManager.addClient(this.id, this)

    this.send({ type: 'authenticated' })
    console.log(`[ws] User ${userId} authenticated on peer ${this.id}`)

    // If the session already has an active watch, sync the client immediately
    if (session.watchedSymbol && session.watchedToken) {
      this.send({ type: 'watching', symbol: session.watchedSymbol, token: session.watchedToken })
      this.send({ type: 'portfolio', data: session.paperTrader.getAllPositions() })
    }
  }

  private async handleWatch(data: any) {
    if (!this.userId || !this.session) {
      this.send({ type: 'error', message: 'Not authenticated' })
      return
    }

    const { symbol, levels, mode, chartTimeframe } = data
    this.chartTimeframe = chartTimeframe || 15

    // Delegate entirely to UserSession — session-level, browser-independent
    await this.session.watch(symbol, levels, mode)
  }

  private cleanupSessionListeners() {
    if (this.session) {
      this.session.paperTrader.off('portfolio_update', this.onPortfolioUpdate)
      this.session.paperTrader.off('pnl_update', this.onPnlUpdate)
      this.session.paperTrader.off('notification', this.onNotification)
      this.session.off('ticks', this.onTicks)
      this.session.off('breakout', this.onBreakout)
      this.session.off('analysis', this.onAnalysis)
      this.session.off('watching', this.onWatching)
      this.session.off('portfolio_sync', this.onPortfolioSync)
      this.session.off('market_closed', this.onMarketClosed)
      this.session.off('watch_error', this.onWatchError)
      this.session.off('token_expired', this.onTokenExpired)
    }
  }

  public destroy() {
    this.cleanupSessionListeners()
    console.log(`[ws] ClientConnection destroyed for peer ${this.id}`)
  }
}
