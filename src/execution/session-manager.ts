import { EventEmitter } from 'node:events'
import { PaperTrader } from './paper-trader.js'
import { createTicker } from '../data/kite-ticker.js'
import { createKiteClient, getInstrumentToken, getOptionToken } from '../data/kite.js'
import { LiveAnalyzer, type AnalysisLevels } from '../analysis/live.js'
import { candleBuilder, seedCandleBuilder } from '../data/candle-builder.js'
import { gtiTracker } from '../indicators/gti-tracker.js'
import { runAnalysis } from '../analysis/trade.js'
import { eventRepo, gtiRepo, userRepo } from '../db/repositories/container.js'
import { isMarketOpen } from '../utils/market-hours.js'
import type { Connect as KiteConnect } from 'kiteconnect'
import type { AIMacroTrend } from '../ai/types.js'

export class UserSession extends EventEmitter {
  public userId: string
  public accessToken: string
  public apiKey: string | undefined
  public kc: KiteConnect
  public ticker: ReturnType<typeof createTicker>
  public paperTrader: PaperTrader
  public tokenExpired: boolean = false

  // ── Analysis State (session-level, browser-independent) ─────────────────
  public analyzer: LiveAnalyzer
  public watchedSymbol: string = ''
  public watchedToken: number = 0
  public watchMode: 'intraday' | 'swing' = 'intraday'
  private isAnalyzing: boolean = false
  private lastDecision: any = null
  private candleCloseHandler: ((data: any) => void) | null = null

  constructor(userId: string, accessToken: string, apiKey?: string, tradeMode: 'PAPER' | 'REAL' = 'PAPER') {
    super()
    this.userId = userId
    this.accessToken = accessToken
    this.apiKey = apiKey
    this.kc = createKiteClient(accessToken, apiKey)
    this.ticker = createTicker(accessToken, apiKey)
    this.paperTrader = new PaperTrader(userId, this.kc)
    this.paperTrader.setTradeMode(tradeMode)
    this.analyzer = new LiveAnalyzer()
  }

  async initialize() {
    await this.paperTrader.initialize()
    this.setupTickerListeners()
    this.ticker.connect()
    await this.autoWatch()
  }

  // ── Watch: Configure session-level analysis for a symbol ────────────────
  async watch(symbol: string, levels?: AnalysisLevels, mode?: 'intraday' | 'swing') {
    const token = await getInstrumentToken(this.kc, symbol)

    if (!token) {
      console.error(`[UserSession] Token not found for ${symbol}`)
      this.emit('watch_error', { message: `Token not found for ${symbol}` })
      return
    }

    await seedCandleBuilder(this.kc, token)

    // Cleanup previous analyzer listeners
    this.analyzer.off('breakout', this.onBreakout)

    // Reset analyzer with fresh state
    this.analyzer = new LiveAnalyzer()
    this.watchedSymbol = symbol
    this.watchedToken = token
    this.watchMode = mode || 'intraday'

    if (!isMarketOpen()) {
      console.log(`[UserSession] Market is closed. Watch registered for ${symbol} in read-only mode.`)
      this.emit('market_closed', { message: 'Market is closed. Operating in read-only mode.' })
    } else {
      if (levels) {
        this.analyzer.setLevels(levels)
      }
      this.analyzer.on('breakout', this.onBreakout)
      console.log(`[UserSession] 🔭 Watching ${symbol} (token: ${token}, mode: ${this.watchMode})`)
    }

    // Subscribe ticker to watched symbol + open position tokens
    const positionTokens = this.paperTrader
      .getAllPositions()
      .map((p) => p.token)
      .filter((t) => !!t)
    const tokensToSubscribe = Array.from(new Set([token, ...positionTokens]))

    this.ticker.subscribe(tokensToSubscribe)
    this.ticker.setMode(this.ticker.modeFull, tokensToSubscribe)

    // Persist watch config to DB
    try {
      await userRepo.updateWatchConfig(this.userId, symbol, this.watchMode)
    } catch (err) {
      console.error(`[UserSession] Failed to persist watch config for ${symbol}:`, err)
    }

    this.emit('watching', { symbol, token })
    this.emit('portfolio_sync', this.paperTrader.getAllPositions())
  }

  async autoWatch() {
    try {
      const config = await userRepo.getWatchConfig(this.userId)
      if (config?.watchedSymbol && isMarketOpen()) {
        console.log(`[UserSession] Auto-watching ${config.watchedSymbol} on initialization...`)
        await this.watch(config.watchedSymbol, undefined, (config.watchedMode as 'intraday' | 'swing') || 'intraday')
      }
    } catch (err) {
      console.error(`[UserSession] Failed to auto-watch on initialization:`, err)
    }
  }

  // ── Breakout Handler (session-level, autonomous) ────────────────────────
  private onBreakout = async (context: any) => {
    if (this.tokenExpired) {
      console.log(`[UserSession] Token is expired. Aborting breakout analysis for ${this.watchedSymbol}.`)
      return
    }

    // Concurrency Lock: Prevent multiple overlapping AI analyses
    if (this.isAnalyzing) {
      console.log(
        `[UserSession] AI is already analyzing for ${this.watchedSymbol}. Dropping concurrent breakout event.`
      )
      return
    }
    this.isAnalyzing = true

    try {
      console.log(`[UserSession] 🔥 Breakout detected for ${this.watchedSymbol}: ${context.reason}`)
      this.emit('breakout', context)

      await eventRepo.saveEvent({
        symbol: this.watchedSymbol,
        reason: context.reason,
        price: context.tick.last_price,
        timestamp: new Date().toISOString(),
        metadata: { tick: context.tick },
      })

      const analysisResult = await runAnalysis(
        this.kc,
        this.watchedSymbol,
        this.watchMode,
        context,
        this.lastDecision,
        undefined,
        this.userId
      )
      const { tf15m: tf, aiDecision: decision, vix, agentType, optionsAnalysis } = analysisResult
      this.lastDecision = decision

      this.emit('analysis', analysisResult)

      if (decision && decision.optionAction !== 'NONE') {
        const type = decision.optionAction === 'BUY_CE' ? 'CE' : 'PE'
        const option = await getOptionToken(this.kc, this.watchedSymbol, decision.strike || 0, type)

        if (option) {
          console.log(`[UserSession] Executing Paper Trade for ${option.symbol} (${agentType} Agent)...`)
          this.ticker.subscribe([option.token])
          this.ticker.setMode(this.ticker.modeFull, [option.token])

          const quote = await this.kc.getQuote([`NFO:${option.symbol}`])
          const entryPrice = quote[`NFO:${option.symbol}`]?.last_price || 0

          if (entryPrice > 0) {
            const optionRow = optionsAnalysis?.rows?.find((r: any) => r.strike === decision.strike && r.type === type)
            const structuralRiskPoints = Math.abs(tf.price - decision.stopLoss)
            const atr14 = analysisResult.dailyContext?.atr14 || 20
            const minAtrRisk = 1.5 * atr14
            const indexRiskPoints = Math.max(structuralRiskPoints, minAtrRisk)
            // Edited 04/10/2026 earlier options delta was hard coded as 0.5
            const estimatedDelta = optionRow?.greeks?.delta
              ? Math.abs(optionRow.greeks.delta)
              : decision.strike && tf.price
                ? type === 'CE'
                  ? tf.price > (decision.strike ?? 0)
                    ? 0.75
                    : 0.4 // ITM CE vs OTM CE
                  : tf.price > (decision.strike ?? 0)
                    ? 0.4
                    : 0.75 // ITM CE vs OTM CE
                : 0.5
            const optionRiskPoints = indexRiskPoints * estimatedDelta

            // Retrieve signal-time option price (pre-LLM options chain analysis)
            const signalPrice = optionRow?.ltp || entryPrice

            // Anchor Target and SL to the Signal Price
            let calculatedSl = signalPrice - optionRiskPoints
            const calculatedTarget = signalPrice + optionRiskPoints * (decision.riskRewardRatio || 1.5)

            const floorPercentage = agentType === 'TREND' ? 0 : 0.2
            const minAllowedSl = Math.max(signalPrice * floorPercentage, 0.05)
            if (calculatedSl < minAllowedSl) calculatedSl = minAllowedSl

            // Slippage Filter
            const maxSlippagePct = Number(process.env.MAX_ENTRY_SLIPPAGE_PCT || 5)
            const slippagePct = ((entryPrice - signalPrice) / signalPrice) * 100

            if (entryPrice > signalPrice * (1 + maxSlippagePct / 100)) {
              console.warn(
                `⚠️ [UserSession] Entry BLOCKED: High slippage. Signal Price: ₹${signalPrice.toFixed(2)}, CMP: ₹${entryPrice.toFixed(2)} (${slippagePct.toFixed(1)}% slippage, limit is ${maxSlippagePct}%).`
              )
              this.emit('notification', {
                title: `⚠️ Trade Blocked (Slippage)`,
                message: `${option.symbol} CMP ₹${entryPrice.toFixed(2)} too high relative to signal ₹${signalPrice.toFixed(2)} (${slippagePct.toFixed(1)}% slippage).`,
                type: 'warning',
              })
              return
            }

            if (entryPrice >= calculatedTarget) {
              console.warn(
                `⚠️ [UserSession] Entry BLOCKED: CMP ₹${entryPrice.toFixed(2)} has already reached or exceeded the target ₹${calculatedTarget.toFixed(2)}.`
              )
              return
            }

            await this.paperTrader.placeOrder({
              symbol: option.symbol,
              token: option.token,
              strike: decision.strike || undefined,
              side: 'BUY',
              quantity: 1,
              price: entryPrice,
              context: {
                optionExpiry: option.expiry.toISOString(),
                optionDelta: estimatedDelta, // Edited 04/10/2026
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
                aiTarget: calculatedTarget,
                aiIndexTargets: decision.targets?.length ? decision.targets : undefined,
                currentIndexPrice: tf.price,
                lotSize: analysisResult.lotSize,
              },
            })
          }
        }
      }
    } catch (err: any) {
      console.error(`[UserSession] Error during breakout analysis:`, err)
      // Check for Zerodha authentication error
      if (err?.message?.includes('Token is invalid') || err?.status === 403 || err?.status === 401) {
        console.error(`[UserSession] 🚨 Zerodha token expired or invalid for user ${this.userId}.`)
        this.tokenExpired = true
        this.emit('token_expired', { message: 'Zerodha token expired. Please re-login.' })
      }
    } finally {
      this.isAnalyzing = false
    }
  }

  // ── Ticker Listeners (session-level, includes tick routing) ─────────────
  private setupTickerListeners() {
    this.ticker.on('ticks', (ticks: any[]) => {
      // 1. Feed PaperTrader for SL/Target monitoring
      ticks.forEach((tick) => {
        this.paperTrader.updatePrice(tick.instrument_token, tick.last_price)
      })

      // 2. Feed global CandleBuilder and GTI Tracker (moved from ClientConnection)
      ticks.forEach((tick) => {
        candleBuilder.addTick(tick)
        gtiTracker.addTick(tick)
      })

      // 3. Feed LiveAnalyzer with watched symbol tick (moved from ClientConnection)
      if (this.watchedToken && this.analyzer) {
        const tick = ticks.find((t) => t.instrument_token === this.watchedToken)
        if (tick) {
          this.analyzer.addTick(tick)
        }
      }

      // 4. Emit ticks for UI relay
      this.emit('ticks', ticks)
    })

    this.ticker.on('connect', () => {
      console.log(`[UserSession] Ticker connected for user ${this.userId}`)

      // Re-subscribe position tokens
      const positionTokens = this.paperTrader.getAllPositions().map((p) => p.token)
      if (positionTokens.length > 0) {
        this.ticker.subscribe(positionTokens)
        this.ticker.setMode(this.ticker.modeFull, positionTokens)
      }

      // Re-subscribe watched token
      if (this.watchedToken) {
        this.ticker.subscribe([this.watchedToken])
        this.ticker.setMode(this.ticker.modeFull, [this.watchedToken])
      }

      this.emit('connect')
    })

    this.ticker.on('error', (err: any) => {
      console.error(`[UserSession] Ticker error for user ${this.userId}:`, err)
      this.emit('ticker_error', err)
    })

    this.ticker.on('close', (reason: any) => {
      console.warn(`[UserSession] Ticker closed for user ${this.userId}:`, reason)
      this.emit('ticker_close', reason)
    })

    // ── GTI: Listen to candle closes for watched token ─────────────────
    this.candleCloseHandler = async ({ token, timeframe, candle }) => {
      if (token !== this.watchedToken) return

      const gtiScore = gtiTracker.onCandleClose(token, candle)

      // Update LiveAnalyzer with fresh GTI score
      if (this.analyzer) {
        this.analyzer.updateGTI(gtiScore)
      }

      // Persist GTI score to DB
      try {
        await gtiRepo.saveScore({
          symbol: this.watchedSymbol || `TOKEN_${token}`,
          token,
          timeframe,
          candleTime: candle.timestamp,
          candle,
          gtiScore,
        })
      } catch (err) {
        console.error(`[UserSession] Failed to persist GTI score for ${this.watchedSymbol}:`, err)
      }
    }
    candleBuilder.on('candle_close', this.candleCloseHandler)
  }

  updateToken(accessToken: string, apiKey?: string) {
    if (this.accessToken === accessToken && this.apiKey === apiKey) {
      return
    }

    console.log(`[UserSession] Token refreshed for user ${this.userId}. Re-initializing client and ticker.`)
    this.accessToken = accessToken
    this.apiKey = apiKey
    this.tokenExpired = false

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

    // Remove old candle_close handler before creating new ticker listeners
    if (this.candleCloseHandler) {
      candleBuilder.off('candle_close', this.candleCloseHandler)
      this.candleCloseHandler = null
    }

    // Recreate and reconnect ticker
    this.ticker = createTicker(accessToken, apiKey)
    this.setupTickerListeners()
    this.ticker.connect()

    // Emit event so other layers (e.g. websocket connections) can re-bind
    this.emit('ticker_recreated')
  }

  destroy() {
    // Cleanup LiveAnalyzer
    this.analyzer.off('breakout', this.onBreakout)

    // Cleanup candle_close listener
    if (this.candleCloseHandler) {
      candleBuilder.off('candle_close', this.candleCloseHandler)
      this.candleCloseHandler = null
    }

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

  getAllSessions(): UserSession[] {
    return Array.from(this.sessions.values())
  }
}

export const sessionManager = new SessionManager()
