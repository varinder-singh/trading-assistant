import axios from "axios"
import type { Candle } from "../types/analysis.js"

export async function getCandles(symbol: string, interval: string = "15m", range: string = "5d"): Promise<Candle[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=${interval}&range=${range}`

  const res = await axios.get(url)
  const result = res.data.chart.result[0]

  const { open, high, low, close, volume } = result.indicators.quote[0]
  const timestamps = result.timestamp

  return timestamps.map((t: number, i: number) => ({
    time: t,
    open: open[i],
    high: high[i],
    low: low[i],
    close: close[i],
    volume: volume[i],
  }))
}

export async function getDualTimeframeCandles(symbol: string) {
  // Fetch both 15-min (5 days) for trend and 5-min (2 days) for entries
  const [candles15m, candles5m] = await Promise.all([
    getCandles(symbol, "15m", "5d"),
    getCandles(symbol, "5m", "2d"),
  ])

  return { candles15m, candles5m }
}
