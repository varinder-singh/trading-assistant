import { EventEmitter } from "node:events"
import { getIntradayBaseline } from "./kite-historical.js"

export class CandleBuilder extends EventEmitter {
  private candles: Map<number, Map<number, any[]>> = new Map()
  private timeframes = [1, 3, 15, 30]

  isSeeded(token: number): boolean {
    return this.candles.has(token) && this.candles.get(token)!.size > 0
  }

  seed(token: number, timeframe: number, historicalCandles: any[]) {
    if (!this.candles.has(token)) this.candles.set(token, new Map())
    const tfMap = this.candles.get(token)!
    // Keep max 500 candles to avoid memory leaks
    tfMap.set(timeframe, historicalCandles.slice(-500))
  }

  addTick(tick: any) {
    if (!tick.instrument_token || !tick.last_price || !tick.exchange_timestamp) return

    const token = tick.instrument_token
    const price = tick.last_price
    const timestamp = tick.exchange_timestamp.getTime()

    if (!this.candles.has(token)) return

    const tfMap = this.candles.get(token)!

    for (const tf of this.timeframes) {
      if (!tfMap.has(tf)) continue
      
      const candles = tfMap.get(tf)!
      const periodMs = tf * 60 * 1000
      
      // Calculate start time of the current candle period
      const currentCandleTime = Math.floor(timestamp / periodMs) * periodMs

      if (candles.length === 0) {
        candles.push({
          date: new Date(currentCandleTime).toISOString(),
          timestamp: currentCandleTime,
          open: price,
          high: price,
          low: price,
          close: price,
          volume: tick.last_traded_quantity || 0
        })
      } else {
        const lastCandle = candles[candles.length - 1]
        const lastCandleTime = new Date(lastCandle.date).getTime()

        if (currentCandleTime > lastCandleTime) {
          // Close previous candle and emit event if needed
          this.emit("candle_close", { token, timeframe: tf, candle: lastCandle })

          // Create new candle
          candles.push({
            date: new Date(currentCandleTime).toISOString(),
            timestamp: currentCandleTime,
            open: price,
            high: price,
            low: price,
            close: price,
            volume: tick.last_traded_quantity || 0
          })

          if (candles.length > 500) candles.shift()
        } else {
          // Update existing candle
          lastCandle.high = Math.max(lastCandle.high, price)
          lastCandle.low = Math.min(lastCandle.low, price)
          lastCandle.close = price
          lastCandle.volume += (tick.last_traded_quantity || 0)
        }
      }
    }
  }

  getCandles(token: number, timeframe: number): any[] {
    return this.candles.get(token)?.get(timeframe) || []
  }
}

export const candleBuilder = new CandleBuilder()

/**
 * Seed CandleBuilder for a specific token if not already seeded.
 */
export async function seedCandleBuilder(kc: any, token: number) {
  if (candleBuilder.isSeeded(token)) return

  console.log(`📊 Seeding CandleBuilder for token ${token}...`)
  try {
    const [c1m, c3m, c15m, c30m] = await Promise.all([
      getIntradayBaseline(kc, token, "minute", 2),
      getIntradayBaseline(kc, token, "3minute", 5),
      getIntradayBaseline(kc, token, "15minute", 5),
      getIntradayBaseline(kc, token, "30minute", 5),
    ])
    candleBuilder.seed(token, 1, c1m)
    candleBuilder.seed(token, 3, c3m)
    candleBuilder.seed(token, 15, c15m)
    candleBuilder.seed(token, 30, c30m)
    console.log(`✅ CandleBuilder seeded for token ${token}.`)
  } catch (err) {
    console.error(`❌ Failed to seed CandleBuilder for token ${token}:`, err)
  }
}
