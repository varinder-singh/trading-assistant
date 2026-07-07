import { createClient } from '@supabase/supabase-js'
import { sessionManager, UserSession } from '@core/execution/session-manager.js'
import { userRepo } from '@core/db/repositories/container.js'
import { decryptSecret } from '@core/utils/crypto.js'
import { LiveAnalyzer } from '@core/analysis/live.js'
import { gtiTracker } from '@core/indicators/gti-tracker.js'
import { candleBuilder, seedCandleBuilder } from '@core/data/candle-builder.js'
import { wsConnectionManager } from './websocket-connection-manager.js'
import { getInstrumentToken, getOptionToken } from '@core/data/kite.js'
import { isMarketOpen } from '@core/utils/market-hours.js'
import { runAnalysis } from '@core/analysis/trade.js'
import { eventRepo } from '@core/db/repositories/container.js'
import type { AIMacroTrend } from '@core/ai/types.js'

// Initialize Supabase client for JWT verification
const supabaseUrl = process.env.SUPABASE_URL || ''
const supabaseKey = process.env.SUPABASE_KEY || ''
const supabase = createClient(supabaseUrl, supabaseKey)

export class ClientConnection {
  public id: string
  public peer: any
  public userId?: string
  public session?: UserSession
  public analyzer: LiveAnalyzer
  public symbol: string = ''
  public token: number = 0
  public mode: 'intraday' | 'swing' = 'intraday'
  public lastDecision: any = null
  public chartTimeframe: number = 15
  public isAnalyzing: boolean = false

  // Bind methods/references so they can be removed cleanly
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
    const tick = ticks.find((t) => t.instrument_token === this.token)
    if (tick) {
      this.analyzer.addTick(tick)
      const currentGTI = gtiTracker.getCurrentScore(this.token)
      this.send({
        type: 'tick',
        data: { ...tick, gtiScore: currentGTI },
      })
    }

    // Also update candle builder globally
    ticks.forEach((tick) => {
      candleBuilder.addTick(tick)
      gtiTracker.addTick(tick)
    })
  }

  private onTickerConnect = () => {
    console.log(`[ClientConnection] Ticker connected for user ${this.userId}. Subscribing watched token: ${this.token}`)
    if (this.token && this.session) {
      this.session.ticker.subscribe([this.token])
      this.session.ticker.setMode(this.session.ticker.modeFull, [this.token])
    }
  }

  private onTickerRecreated = () => {
    console.log(`[ClientConnection] Ticker recreated for user ${this.userId}. Re-subscribing watched token.`)
    if (this.session && this.token) {
      this.session.ticker.subscribe([this.token])
      this.session.ticker.setMode(this.session.ticker.modeFull, [this.token])
    }
  }

  private onBreakout = async (context: any) => {
    // Concurrency Lock: Prevent multiple overlapping AI analyses for the same client
    if (this.isAnalyzing) {
      console.log(`[ws] AI is already analyzing for ${this.symbol}. Dropping concurrent breakout event.`)
      return
    }
    this.isAnalyzing = true

    try {
      console.log(`[ws] Breakout detected for ${this.symbol}`)
      this.send({ type: 'breakout', data: context })

      await eventRepo.saveEvent({
        symbol: this.symbol,
        reason: context.reason,
        price: context.tick.last_price,
        timestamp: new Date().toISOString(),
        metadata: { tick: context.tick },
      })

      if (!this.session || !this.userId) return

      const analysisResult = await runAnalysis(
        this.session.kc,
        this.symbol,
        this.mode,
        context,
        this.lastDecision,
        undefined,
        this.userId
      )
      const { tf15m: tf, aiDecision: decision, vix, agentType } = analysisResult
      this.lastDecision = decision

      this.send({ type: 'analysis', data: analysisResult })

      if (decision && decision.optionAction !== 'NONE') {
        const type = decision.optionAction === 'BUY_CE' ? 'CE' : 'PE'
        const option = await getOptionToken(this.session.kc, this.symbol, decision.strike || 0, type)

        if (option) {
          console.log(`[ws] Executing Paper Trade for ${option.symbol} (${agentType} Agent)...`)
          this.session.ticker.subscribe([option.token])
          this.session.ticker.setMode(this.session.ticker.modeFull, [option.token])

          const quote = await this.session.kc.getQuote([`NFO:${option.symbol}`])
          const entryPrice = quote[`NFO:${option.symbol}`]?.last_price || 0

          if (entryPrice > 0) {
            const indexRiskPoints = Math.abs(tf.price - decision.stopLoss)
            const estimatedDelta = 0.5
            const optionRiskPoints = indexRiskPoints * estimatedDelta

            let calculatedSl = entryPrice - optionRiskPoints
            const calculatedTarget = entryPrice + optionRiskPoints * (decision.riskRewardRatio || 1.5)

            const floorPercentage = agentType === 'TREND' ? 0 : 0.2
            const minAllowedSl = Math.max(entryPrice * floorPercentage, 0.05)
            if (calculatedSl < minAllowedSl) calculatedSl = minAllowedSl

            await this.session.paperTrader.placeOrder({
              symbol: option.symbol,
              token: option.token,
              strike: decision.strike || undefined,
              side: 'BUY',
              quantity: 1,
              price: entryPrice,
              context: {
                optionExpiry: option.expiry.toISOString(),
                aiReasoning: decision.reason,
                aiConfidence: decision.confidence,
                aiStrike: decision.strike || undefined,
                aiSetup: decision.setup,
                strategyContext: {
                  macroTrend: decision.macroTrend as AIMacroTrend,
                  indexSl: decision.stopLoss,
                  agentType,
                },
                vixLevel: vix.current,
                rsiLevel: tf.rsi,
                trend15m: tf.trend,
                aiStopLoss: calculatedSl,
                aiIndexTargets: decision.targets?.length ? decision.targets : undefined,
                currentIndexPrice: tf.price,
                lotSize: analysisResult.lotSize,
              },
            })
          }
        }
      }
    } catch (err) {
      console.error(`[ws] Error during breakout analysis:`, err)
    } finally {
      this.isAnalyzing = false
    }
  }

  constructor(peer: any) {
    this.peer = peer
    this.id = peer.id
    this.analyzer = new LiveAnalyzer()
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

    // Register listeners
    session.paperTrader.on('portfolio_update', this.onPortfolioUpdate)
    session.paperTrader.on('pnl_update', this.onPnlUpdate)
    session.paperTrader.on('notification', this.onNotification)
    session.on('ticks', this.onTicks)
    session.on('connect', this.onTickerConnect)
    session.on('ticker_recreated', this.onTickerRecreated)

    // Update connection status in wsConnectionManager
    wsConnectionManager.addClient(this.id, this)

    this.send({ type: 'authenticated' })
    console.log(`[ws] User ${userId} authenticated on peer ${this.id}`)
  }

  private async handleWatch(data: any) {
    if (!this.userId || !this.session) {
      this.send({ type: 'error', message: 'Not authenticated' })
      return
    }

    const { symbol, levels, mode, chartTimeframe } = data
    const token = await getInstrumentToken(this.session.kc, symbol)

    if (!token) {
      this.send({ type: 'error', message: `Token not found for ${symbol}` })
      return
    }

    await seedCandleBuilder(this.session.kc, token)

    // Cleanup previous breakout listener if switching symbols
    if (this.analyzer) {
      this.analyzer.off('breakout', this.onBreakout)
    }

    this.analyzer = new LiveAnalyzer()
    this.symbol = symbol
    this.token = token
    this.mode = mode || 'intraday'
    this.chartTimeframe = chartTimeframe || 1

    if (!isMarketOpen()) {
      this.send({ type: 'market_closed', message: 'Market is closed. Operating in read-only mode.' })
    } else {
      if (levels) {
        this.analyzer.setLevels(levels)
      }
      this.analyzer.on('breakout', this.onBreakout)
    }

    const positionTokens = this.session.paperTrader
      .getAllPositions()
      .map((p) => p.token)
      .filter((t) => !!t)
    const tokensToSubscribe = Array.from(new Set([token, ...positionTokens]))

    this.session.ticker.subscribe(tokensToSubscribe)
    this.session.ticker.setMode(this.session.ticker.modeFull, tokensToSubscribe)

    this.send({ type: 'watching', symbol, token })
    this.send({ type: 'portfolio', data: this.session.paperTrader.getAllPositions() })
  }

  private cleanupSessionListeners() {
    if (this.session) {
      this.session.paperTrader.off('portfolio_update', this.onPortfolioUpdate)
      this.session.paperTrader.off('pnl_update', this.onPnlUpdate)
      this.session.paperTrader.off('notification', this.onNotification)
      this.session.off('ticks', this.onTicks)
      this.session.off('connect', this.onTickerConnect)
      this.session.off('ticker_recreated', this.onTickerRecreated)
    }
  }

  public destroy() {
    this.cleanupSessionListeners()
    if (this.analyzer) {
      this.analyzer.off('breakout', this.onBreakout)
    }
    console.log(`[ws] ClientConnection destroyed for peer ${this.id}`)
  }
}
