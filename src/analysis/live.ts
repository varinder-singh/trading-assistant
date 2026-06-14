import { EventEmitter } from "node:events"
import type { GTIScore } from "../types/analysis.js"
import { isMarketOpen } from "../utils/market.js"

export interface LiveTick {
  last_price: number
  volume_traded?: number
  timestamp?: Date
  instrument_token: number
  received_at?: number
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

  constructor() {
    super()
  }

  setLevels(levels: AnalysisLevels) {
    this.levels = levels
  }

  addTick(tick: LiveTick) {
    tick.received_at = Date.now()
    this.ticks.push(tick)
    this.cleanupOldTicks()
    this.checkTriggers(tick)
  }

  /**
   * Update the current GTI score. Called by the WS server when GTI is computed.
   */
  updateGTI(gtiScore: GTIScore) {
    const prevScore = this.lastGTIScore
    this.lastGTIScore = gtiScore

    if (!prevScore) return
    if (!isMarketOpen()) return

    const now = Date.now()
    if (now - this.lastTriggerTime < this.triggerCooldownMs) return

    // GTI Surge: Score crosses the institutional threshold
    const wasBelowThreshold = Math.abs(prevScore.composite) < this.gtiSurgeThreshold
    const isAboveThreshold = Math.abs(gtiScore.composite) >= this.gtiSurgeThreshold
    if (wasBelowThreshold && isAboveThreshold) {
      const direction = gtiScore.composite > 0 ? "ACCUMULATION" : "DISTRIBUTION"
      this.trigger(
        `GTI Institutional Surge: ${direction} (${gtiScore.composite.toFixed(2)}, ${gtiScore.classification})`,
        { last_price: this.priceAtLastGTICheck, instrument_token: 0, received_at: now } as LiveTick
      )
    }

    // GTI Divergence: Price rising but GTI falling, or vice versa
    if (prevScore.confidence > 30 && gtiScore.confidence > 30) {
      const lastTick = this.ticks.length > 0 ? this.ticks[this.ticks.length - 1] : undefined
      const priceRising = this.priceAtLastGTICheck > 0 && lastTick && lastTick.last_price > this.priceAtLastGTICheck
      const gtiDropping = gtiScore.composite < prevScore.composite - 0.3

      if (priceRising && gtiDropping && lastTick) {
        this.trigger(
          `GTI Divergence: Price rising but institutional flow weakening (${gtiScore.composite.toFixed(2)} ← ${prevScore.composite.toFixed(2)})`,
          {
            last_price: lastTick.last_price,
            instrument_token: lastTick.instrument_token,
            received_at: now,
          } as LiveTick
        )
      }
    }

    if (this.ticks.length > 0) {
      const last = this.ticks[this.ticks.length - 1]
      if (last) {
        this.priceAtLastGTICheck = last.last_price
      }
    }
  }

  private cleanupOldTicks() {
    const now = Date.now()
    this.ticks = this.ticks.filter((t) => {
      const tickTime = t.received_at ?? now
      return now - tickTime < this.windowSizeMs
    })
  }

  private checkTriggers(tick: LiveTick) {
    if (!this.levels) return
    if (!isMarketOpen()) return

    const now = Date.now()
    if (now - this.lastTriggerTime < this.triggerCooldownMs) return

    const { last_price } = tick
    const { resistance, support } = this.levels

    // 1. Level Breakout
    if (last_price > resistance) {
      this.trigger("Price broke Resistance", tick)
    } else if (last_price < support) {
      this.trigger("Price broke Support", tick)
    }

    // 2. Volatility Spike (0.1% move in 1 minute)
    if (this.ticks.length > 1) {
      const firstTick = this.ticks[0]
      if (firstTick) {
        const priceChange = Math.abs((last_price - firstTick.last_price) / firstTick.last_price)
        if (priceChange > 0.001) {
          this.trigger(`Volatility Spike: ${(priceChange * 100).toFixed(2)}% move in 1m`, tick)
        }
      }
    }
  }

  private trigger(reason: string, tick: LiveTick) {
    this.lastTriggerTime = Date.now()
    this.emit("breakout", {
      reason,
      tick,
      recentTicks: [...this.ticks],
    })
  }

  getRecentTicks() {
    return this.ticks
  }
}
