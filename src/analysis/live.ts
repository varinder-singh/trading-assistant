import { EventEmitter } from 'node:events'
import type { GTIScore } from '../types/analysis.js'
import { isMarketOpen } from '../utils/market-hours.js'

export interface LiveTick {
  last_price: number
  volume_traded?: number | undefined
  timestamp?: Date | undefined
  instrument_token: number
  received_at?: number | undefined
}

export interface AnalysisLevels {
  resistance: number
  support: number
  vwap: number
}

export class LiveAnalyzer extends EventEmitter {
  private ticks: LiveTick[] = []
  private levels: AnalysisLevels | null = null
  private windowSizeMs = 60 * 1000 // 1 minute window for volatility
  private lastTriggerTime = 0
  private triggerCooldownMs = 5 * 60 * 1000 // 5 minutes cooldown between AI calls
  private lastGTIScore?: GTIScore
  private gtiSurgeThreshold = 1.5
  private priceAtLastGTICheck = 0

  constructor() {
    super()
  }

  public setLevels(levels: AnalysisLevels): void {
    this.levels = levels
  }

  public addTick(tick: LiveTick): void {
    tick.received_at = Date.now()

    const lastTick = this.ticks.length > 0 ? this.ticks[this.ticks.length - 1] : null
    const isSamePrice = lastTick?.last_price === tick.last_price

    this.ticks = isSamePrice
      ? this.ticks.map((t, i) => (i === this.ticks.length - 1 ? { ...t, received_at: tick.received_at } : t))
      : [...this.ticks, tick]

    this.cleanupOldTicks()
    this.checkTriggers(tick)
  }

  /**
   * Update the current GTI score. Called by the WS server when GTI is computed.
   */
  public updateGTI(gtiScore: GTIScore): void {
    const prevScore = this.lastGTIScore
    this.lastGTIScore = gtiScore

    if (!prevScore || !isMarketOpen()) return

    const now = Date.now()
    if (now - this.lastTriggerTime < this.triggerCooldownMs) return

    this.checkGtiSurge(prevScore, gtiScore, now)
    this.checkGtiDivergence(prevScore, gtiScore, now)

    const last = this.ticks[this.ticks.length - 1]
    if (last) {
      this.priceAtLastGTICheck = last.last_price
    }
  }

  private checkGtiSurge(prevScore: GTIScore, gtiScore: GTIScore, now: number): void {
    const wasBelowThreshold = Math.abs(prevScore.composite) < this.gtiSurgeThreshold
    const isAboveThreshold = Math.abs(gtiScore.composite) >= this.gtiSurgeThreshold
    if (!wasBelowThreshold || !isAboveThreshold) return

    const direction = gtiScore.composite > 0 ? 'ACCUMULATION' : 'DISTRIBUTION'
    this.trigger(
      `GTI Institutional Surge: ${direction} (${gtiScore.composite.toFixed(2)}, ${gtiScore.classification})`,
      { last_price: this.priceAtLastGTICheck, instrument_token: 0, received_at: now }
    )
  }

  private checkGtiDivergence(prevScore: GTIScore, gtiScore: GTIScore, now: number): void {
    if (prevScore.confidence <= 30 || gtiScore.confidence <= 30) return

    const lastTick = this.ticks[this.ticks.length - 1]
    if (!lastTick) return

    const priceRising = this.priceAtLastGTICheck > 0 && lastTick.last_price > this.priceAtLastGTICheck
    const gtiDropping = gtiScore.composite < prevScore.composite - 0.3

    if (priceRising && gtiDropping) {
      this.trigger(
        `GTI Divergence: Price rising but institutional flow weakening (${gtiScore.composite.toFixed(2)} ← ${prevScore.composite.toFixed(2)})`,
        {
          last_price: lastTick.last_price,
          instrument_token: lastTick.instrument_token,
          received_at: now,
        }
      )
    }
  }

  private cleanupOldTicks(): void {
    const now = Date.now()
    const filtered = this.ticks.filter((t) => now - (t.received_at ?? now) < this.windowSizeMs)
    this.ticks = filtered.length > 500 ? filtered.slice(-500) : filtered
  }

  private checkTriggers(tick: LiveTick): void {
    if (!this.levels || !isMarketOpen()) return

    const now = Date.now()
    if (now - this.lastTriggerTime < this.triggerCooldownMs) return

    const { last_price } = tick
    const { resistance, support } = this.levels

    if (last_price > resistance) {
      this.trigger('Price broke Resistance', tick)
    } else if (last_price < support) {
      this.trigger('Price broke Support', tick)
    }

    if (this.ticks.length <= 1) return
    const firstTick = this.ticks[0]
    if (!firstTick) return

    const priceChange = Math.abs((last_price - firstTick.last_price) / firstTick.last_price)
    if (priceChange > 0.001) {
      this.trigger(`Volatility Spike: ${(priceChange * 100).toFixed(2)}% move in 1m`, tick)
    }
  }

  private trigger(reason: string, tick: LiveTick): void {
    this.lastTriggerTime = Date.now()
    this.emit('breakout', {
      reason,
      tick,
      recentTicks: [...this.ticks],
    })
  }

  public getRecentTicks(): LiveTick[] {
    return this.ticks
  }
}
