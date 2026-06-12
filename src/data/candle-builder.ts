import { EventEmitter } from "node:events"
import type { Candle } from "../types/analysis.js"
import type { LiveTick } from "../analysis/live.js"

export class CandleBuilder extends EventEmitter {
  private candlesByToken: Map<number, Map<number, Candle[]>> = new Map()
  private timeframes: number[] = [1, 3, 15, 30] // minutes
  private lastVolumeByToken: Map<number, Map<number, number>> = new Map()

  constructor() {
    super()
  }

  /**
   * Seed the builder with historical candles for a specific token.
   * Expects time to be in seconds.
   */
  seed(token: number, timeframe: number, historicalCandles: Candle[]) {
    if (!this.candlesByToken.has(token)) {
      this.candlesByToken.set(token, new Map())
      this.lastVolumeByToken.set(token, new Map())
      for (const tf of this.timeframes) {
        this.candlesByToken.get(token)!.set(tf, [])
      }
    }

    if (this.timeframes.includes(timeframe)) {
      // Sort and ensure no duplicates
      const sorted = [...historicalCandles].sort((a, b) => a.time - b.time)
      this.candlesByToken.get(token)!.set(timeframe, sorted)
    }
  }

  /**
   * Add a new tick to update current candles across all timeframes.
   */
  addTick(tick: LiveTick) {
    const token = tick.instrument_token
    if (!token) return

    if (!this.candlesByToken.has(token)) {
      this.candlesByToken.set(token, new Map())
      this.lastVolumeByToken.set(token, new Map())
      for (const tf of this.timeframes) {
        this.candlesByToken.get(token)!.set(tf, [])
      }
    }

    const timestamp = tick.timestamp ? new Date(tick.timestamp).getTime() : Date.now()
    const lastPrice = tick.last_price
    const totalVolume = tick.volume_traded || 0

    const tokenCandles = this.candlesByToken.get(token)!
    const tokenVolumes = this.lastVolumeByToken.get(token)!

    for (const tf of this.timeframes) {
      const ms = tf * 60 * 1000
      const periodStartSeconds = Math.floor(timestamp / ms) * (ms / 1000)
      const candles = tokenCandles.get(tf)!
      const lastCandle = candles[candles.length - 1]

      if (!lastCandle || lastCandle.time < periodStartSeconds) {
        // Emit candle_close for the completed candle before starting a new one
        if (lastCandle) {
          this.emit("candle_close", { token, timeframe: tf, candle: lastCandle })
        }

        // Determine the volume of the NEW candle.
        let startingVolume = 0
        if (tokenVolumes.has(tf) && totalVolume > 0) {
          startingVolume = Math.max(0, totalVolume - tokenVolumes.get(tf)!)
        }

        const newCandle: Candle = {
          time: periodStartSeconds,
          open: lastPrice,
          high: lastPrice,
          low: lastPrice,
          close: lastPrice,
          volume: startingVolume,
        }
        candles.push(newCandle)
        tokenVolumes.set(tf, totalVolume)

        if (candles.length > 500) candles.shift()
      } else {
        // Update current candle
        lastCandle.high = Math.max(lastCandle.high, lastPrice)
        lastCandle.low = Math.min(lastCandle.low, lastPrice)
        lastCandle.close = lastPrice

        if (totalVolume > 0 && tokenVolumes.has(tf)) {
          const diff = Math.max(0, totalVolume - tokenVolumes.get(tf)!)
          lastCandle.volume += diff
          tokenVolumes.set(tf, totalVolume)
        } else if (totalVolume > 0) {
          tokenVolumes.set(tf, totalVolume)
        }
      }
    }
  }

  getCandles(token: number, timeframe: number): Candle[] {
    const tokenMap = this.candlesByToken.get(token)
    if (!tokenMap) return []
    return tokenMap.get(timeframe) || []
  }

  isSeeded(token: number): boolean {
    const tokenMap = this.candlesByToken.get(token)
    if (!tokenMap) return false
    // Consider seeded if at least one major timeframe has candles
    return (tokenMap.get(15)?.length || 0) > 0
  }
}

export const candleBuilder = new CandleBuilder()
