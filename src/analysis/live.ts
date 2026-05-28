import { EventEmitter } from "node:events"

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

  private cleanupOldTicks() {
    const now = Date.now()
    this.ticks = this.ticks.filter((t) => {
      const tickTime = t.received_at ?? now
      return now - tickTime < this.windowSizeMs
    })
  }

  private checkTriggers(tick: LiveTick) {
    if (!this.levels) return

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
