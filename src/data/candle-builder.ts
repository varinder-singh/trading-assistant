import { EventEmitter } from "node:events"
import { getIntradayBaseline } from "./kite-historical.js"

export class CandleBuilder extends EventEmitter {
  private candles: Map<number, Map<number, any[]>> = new Map()
  private timeframes = [1, 3, 15, 30]

  public isSeeded(token: number): boolean {
    return (this.candles.get(token)?.size ?? 0) > 0
  }

  public seed(token: number, timeframe: number, historicalCandles: any[]): void {
    if (!this.candles.has(token)) this.candles.set(token, new Map())
    const tfMap = this.candles.get(token)!
    tfMap.set(timeframe, historicalCandles.slice(-500))
  }

  public addTick(tick: any): void {
    if (!tick.instrument_token || !tick.last_price || !tick.exchange_timestamp) return

    const token = tick.instrument_token
    const tfMap = this.candles.get(token)
    if (!tfMap) return

    const price = tick.last_price
    const timestamp = tick.exchange_timestamp.getTime()
    const volume = tick.last_traded_quantity || 0

    this.timeframes.forEach((tf) => {
      const candles = tfMap.get(tf)
      if (candles) {
        this.updateTimeframeCandle(token, tf, candles, price, timestamp, volume)
      }
    })
  }

  private updateTimeframeCandle(
    token: number,
    tf: number,
    candles: any[],
    price: number,
    timestamp: number,
    volume: number
  ): void {
    const periodMs = tf * 60 * 1000
    const currentCandleTime = Math.floor(timestamp / periodMs) * periodMs
    const lastCandle = candles[candles.length - 1]

    if (!lastCandle) {
      candles.push(this.createNewCandle(currentCandleTime, price, volume))
      return
    }

    const lastCandleTime = new Date(lastCandle.date).getTime()

    if (currentCandleTime > lastCandleTime) {
      this.emit("candle_close", { token, timeframe: tf, candle: lastCandle })
      candles.push(this.createNewCandle(currentCandleTime, price, volume))
      if (candles.length > 500) candles.shift()
      return
    }

    lastCandle.high = Math.max(lastCandle.high, price)
    lastCandle.low = Math.min(lastCandle.low, price)
    lastCandle.close = price
    lastCandle.volume += volume
  }

  private createNewCandle(currentCandleTime: number, price: number, volume: number) {
    return {
      date: new Date(currentCandleTime).toISOString(),
      timestamp: currentCandleTime,
      open: price,
      high: price,
      low: price,
      close: price,
      volume,
    }
  }

  public getCandles(token: number, timeframe: number): any[] {
    return this.candles.get(token)?.get(timeframe) || []
  }
}

export const candleBuilder = new CandleBuilder()

export async function seedCandleBuilder(kc: any, token: number): Promise<void> {
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
