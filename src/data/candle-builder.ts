import type { Candle } from "../types/analysis.js"
import type { LiveTick } from "../analysis/live.js"

export class CandleBuilder {
  private candles: Map<number, Candle[]> = new Map()
  private timeframes: number[] = [1, 3, 15, 30] // minutes
  private lastVolume: Map<number, number> = new Map()

  constructor() {
    for (const tf of this.timeframes) {
      this.candles.set(tf, [])
    }
  }

  /**
   * Seed the builder with historical candles.
   * Expects time to be in seconds.
   */
  seed(timeframe: number, historicalCandles: Candle[]) {
    if (this.timeframes.includes(timeframe)) {
      // Sort and ensure no duplicates
      const sorted = [...historicalCandles].sort((a, b) => a.time - b.time)
      this.candles.set(timeframe, sorted)
    }
  }

  /**
   * Add a new tick to update current candles across all timeframes.
   */
  addTick(tick: LiveTick) {
    const timestamp = tick.timestamp ? new Date(tick.timestamp).getTime() : Date.now()
    const lastPrice = tick.last_price
    const totalVolume = tick.volume_traded || 0

    for (const tf of this.timeframes) {
      const ms = tf * 60 * 1000
      const periodStartSeconds = Math.floor(timestamp / ms) * (ms / 1000)
      const candles = this.candles.get(tf)!
      const lastCandle = candles[candles.length - 1]

      if (!lastCandle || lastCandle.time < periodStartSeconds) {
        // Determine the volume of the NEW candle. 
        // If it's the first tick ever, volume is 0 until next tick.
        // If we have previous volume, the jump is the new candle's starting volume.
        let startingVolume = 0
        if (this.lastVolume.has(tf) && totalVolume > 0) {
            startingVolume = Math.max(0, totalVolume - this.lastVolume.get(tf)!)
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
        this.lastVolume.set(tf, totalVolume)

        if (candles.length > 500) candles.shift()
      } else {
        // Update current candle
        lastCandle.high = Math.max(lastCandle.high, lastPrice)
        lastCandle.low = Math.min(lastCandle.low, lastPrice)
        lastCandle.close = lastPrice
        
        if (totalVolume > 0 && this.lastVolume.has(tf)) {
            const diff = Math.max(0, totalVolume - this.lastVolume.get(tf)!)
            lastCandle.volume += diff
            this.lastVolume.set(tf, totalVolume)
        } else if (totalVolume > 0) {
            this.lastVolume.set(tf, totalVolume)
        }
      }
    }
  }

  getCandles(timeframe: number): Candle[] {
    return this.candles.get(timeframe) || []
  }
}

export const candleBuilder = new CandleBuilder()
