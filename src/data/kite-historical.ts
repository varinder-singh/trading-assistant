import "dotenv/config"
import type { Connect as KiteConnect } from "kiteconnect"
import type { Candle } from "../types/analysis.js"

/**
 * Fetches the closing Open Interest for the previous trading day.
 */
export async function getYesterdayClosingOI(kc: KiteConnect, tokens: number[]): Promise<Map<number, number>> {
  const oiMap = new Map<number, number>()

  // Find yesterday's date
  const now = new Date()
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)

  // Handle weekends
  if (yesterday.getDay() === 0) yesterday.setDate(yesterday.getDate() - 2) // Sunday -> Friday
  if (yesterday.getDay() === 6) yesterday.setDate(yesterday.getDate() - 1) // Saturday -> Friday

  const dateStr = yesterday.toISOString().split("T")[0]
  const from = `${dateStr} 09:15:00`
  const to = `${dateStr} 15:30:00`

  console.log(`[Historical] Fetching baseline OI for ${tokens.length} tokens for ${dateStr}...`)

  // Kite allows 3 requests per second for historical data, so we fetch in sequence
  for (const token of tokens) {
    try {
      const data = await kc.getHistoricalData(token.toString(), "day", from, to, false, true)
      if (data && data.length > 0) {
        const lastCandle = data[data.length - 1]
        if (lastCandle && lastCandle.oi !== undefined) {
          oiMap.set(token, lastCandle.oi)
        }
      }
    } catch (err) {
      console.error(`[Historical] Failed to fetch OI for token ${token}:`, err)
    }
  }

  return oiMap
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

  const fromStr = from.toISOString().replace("T", " ").split(".")[0]
  const toStr = now.toISOString().replace("T", " ").split(".")[0]

  try {
    const data = await kc.getHistoricalData(token.toString(), interval, fromStr as string, toStr as string)
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
