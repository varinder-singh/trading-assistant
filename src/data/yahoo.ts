import axios from "axios"
import type { Connect as KiteConnectInstance } from "kiteconnect"
import type { Candle } from "../types/analysis.js"
import { getInstrumentToken } from "./kite.js"
import { resolveYahooTicker } from "../utils/symbol.js"

export async function getKiteCandles(
  kc: KiteConnectInstance,
  token: number,
  interval: string,
  days: number
): Promise<Candle[]> {
  const now = new Date()
  const from = new Date(now)
  from.setDate(from.getDate() - days)

  const fromStr = from.toISOString().replace("T", " ").split(".")[0]
  const toStr = now.toISOString().replace("T", " ").split(".")[0]

  let kiteInterval = interval
  if (interval === "1h") kiteInterval = "60minute"
  if (interval === "1d") kiteInterval = "day"
  if (interval === "3m") kiteInterval = "3minute"
  if (interval === "15m") kiteInterval = "15minute"
  if (interval === "30m") kiteInterval = "30minute"

  const data = await kc.getHistoricalData(token.toString(), kiteInterval as any, fromStr as string, toStr as string)
  return data.map((d: any) => ({
    time: new Date(d.date).getTime() / 1000,
    open: d.open,
    high: d.high,
    low: d.low,
    close: d.close,
    volume: d.volume,
  }))
}

export async function getKiteMultiTimeframeCandles(kc: KiteConnectInstance, symbol: string) {
  const token = await getInstrumentToken(kc, symbol)
  if (!token) {
    throw new Error(`Kite token not found for symbol: ${symbol}`)
  }

  const [candles1d, candles1h, candles30m, candles15m, candles3m] = await Promise.all([
    getKiteCandles(kc, token, "1d", 60),
    getKiteCandles(kc, token, "1h", 30),
    getKiteCandles(kc, token, "30m", 5),
    getKiteCandles(kc, token, "15m", 5),
    getKiteCandles(kc, token, "3m", 2),
  ])

  return { candles1d, candles1h, candles30m, candles15m, candles3m }
}

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

export async function getMultiTimeframeCandles(symbol: string, kc?: KiteConnectInstance) {
  if (kc) {
    try {
      console.log(`[Candles] Fetching primary candles from Zerodha/Kite for ${symbol}...`)
      return await getKiteMultiTimeframeCandles(kc, symbol)
    } catch (err) {
      console.warn(`[Candles] Zerodha/Kite candles fetch failed, falling back to Yahoo for ${symbol}:`, err)
    }
  }

  // Fallback to Yahoo Finance
  const yahooTicker = resolveYahooTicker(symbol)
  console.log(`[Candles] Fetching fallback candles from Yahoo Finance for ${yahooTicker}...`)

  const [candles1d, candles1h, candles30m, candles15m, candles1m] = await Promise.all([
    getCandles(yahooTicker, "1d", "60d"),
    getCandles(yahooTicker, "1h", "1mo"),
    getCandles(yahooTicker, "30m", "5d"),
    getCandles(yahooTicker, "15m", "5d"),
    getCandles(yahooTicker, "1m", "2d"),
  ])

  // Aggregate 1m into 3m candles
  const candles3m: Candle[] = []
  for (let i = 0; i < candles1m.length; i += 3) {
    const chunk = candles1m.slice(i, i + 3)
    if (chunk.length === 0) continue

    const first = chunk[0];
    const last = chunk[chunk.length - 1];
    if (!first || !last) continue;

    candles3m.push({
      time: first.time,
      open: first.open,
      high: Math.max(...chunk.map(c => c.high)),
      low: Math.min(...chunk.map(c => c.low)),
      close: last.close,
      volume: chunk.reduce((sum, c) => sum + (c.volume || 0), 0),
    })
  }

  return { candles1d, candles1h, candles30m, candles15m, candles3m }
}
