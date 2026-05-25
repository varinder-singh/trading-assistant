import axios from "axios"
import type { Candle } from "../types/analysis.js"

export async function getCandles(symbol: string, interval: string = "15m", range: string = "5d"): Promise<Candle[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=${interval}&range=${range}`

  const res = await axios.get(url)
  const result = res.data.chart.result[0]

  const { open, high, low, close, volume } = result.indicators.quote[0]
  const timestamps = result.timestamp

  return timestamps
    .map((t: number, i: number) => ({
      time: t,
      open: open[i],
      high: high[i],
      low: low[i],
      close: close[i],
      volume: volume[i],
    }))
    .filter((c: any) => c.open !== null && c.high !== null && c.low !== null && c.close !== null) as Candle[]
}

export async function getMultiTimeframeCandles(symbol: string) {
  // Fetch 1h (1 month) for macro, 15-min (5 days) for trend, and 1-min (2 days) for 3m execution
  const [candles1h, candles15m, candles1m] = await Promise.all([
    getCandles(symbol, "1h", "1mo"),
    getCandles(symbol, "15m", "5d"),
    getCandles(symbol, "1m", "2d"),
  ])

  // Aggregate 1m into 3m candles
  const candles3m: Candle[] = []
  for (let i = 0; i < candles1m.length; i += 3) {
    const chunk = candles1m.slice(i, i + 3)
    if (chunk.length === 0) continue

    candles3m.push({
      time: chunk[0].time,
      open: chunk[0].open,
      high: Math.max(...chunk.map(c => c.high)),
      low: Math.min(...chunk.map(c => c.low)),
      close: chunk[chunk.length - 1].close,
      volume: chunk.reduce((sum, c) => sum + c.volume, 0),
    })
  }

  return { candles1h, candles15m, candles3m }
}
