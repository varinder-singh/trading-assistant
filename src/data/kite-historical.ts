import "dotenv/config"
import type { Connect as KiteConnect } from "kiteconnect"
import type { Candle } from "../types/analysis.js"

function getYesterdayTradingDate(): string {
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)

  if (yesterday.getDay() === 0) yesterday.setDate(yesterday.getDate() - 2) // Sunday -> Friday
  if (yesterday.getDay() === 6) yesterday.setDate(yesterday.getDate() - 1) // Saturday -> Friday

  return yesterday.toISOString().split("T")[0]!
}

/**
 * Fetches the closing Open Interest for the previous trading day.
 */
export async function getYesterdayClosingOI(kc: KiteConnect, tokens: number[]): Promise<Map<number, number>> {
  const dateStr = getYesterdayTradingDate()
  const from = `${dateStr} 09:15:00`
  const to = `${dateStr} 15:30:00`

  console.log(`[Historical] Fetching baseline OI for ${tokens.length} tokens for ${dateStr}...`)

  // Kite allows 3 requests per second for historical data, so we fetch sequentially
  return tokens.reduce(async (accPromise, token) => {
    const acc = await accPromise
    try {
      const data = await kc.getHistoricalData(token.toString(), "day", from, to, false, true)
      const lastCandle = data && data.length > 0 ? data[data.length - 1] : undefined
      if (lastCandle && lastCandle.oi !== undefined) {
        acc.set(token, lastCandle.oi)
      }
    } catch (err) {
      console.error(`[Historical] Failed to fetch OI for token ${token}:`, err)
    }
    return acc
  }, Promise.resolve(new Map<number, number>()))
}

/**
 * Fetches historical intraday candles to seed the CandleBuilder.
 */
export async function getIntradayBaseline(
  kc: KiteConnect,
  token: number,
  interval: "minute" | "3minute" | "15minute" | "30minute",
  days: number = 5
): Promise<Candle[]> {
  const now = new Date()
  const from = new Date(now)
  from.setDate(from.getDate() - days)

  const fromStr = from.toISOString().replace("T", " ").split(".")[0]!
  const toStr = now.toISOString().replace("T", " ").split(".")[0]!

  try {
    const data = await kc.getHistoricalData(token.toString(), interval, fromStr, toStr)
    return data.map((d: any) => ({
      time: new Date(d.date).getTime() / 1000,
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close,
      volume: d.volume,
    }))
  } catch (err) {
    console.error(`[Historical] Failed to fetch baseline candles for token ${token}:`, err)
    return []
  }
}
