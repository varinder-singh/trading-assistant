import "dotenv/config"
import kc from "./kite.js"

/**
 * Fetches the closing Open Interest for the previous trading day.
 */
export async function getYesterdayClosingOI(tokens: number[]): Promise<Map<number, number>> {
  const oiMap = new Map<number, number>()
  
  // Find yesterday's date
  const now = new Date()
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  
  // Handle weekends
  if (yesterday.getDay() === 0) yesterday.setDate(yesterday.getDate() - 2) // Sunday -> Friday
  if (yesterday.getDay() === 6) yesterday.setDate(yesterday.getDate() - 1) // Saturday -> Friday

  const dateStr = yesterday.toISOString().split('T')[0]
  const from = `${dateStr} 09:15:00`
  const to = `${dateStr} 15:30:00`

  console.log(`[Historical] Fetching baseline OI for ${tokens.length} tokens for ${dateStr}...`)

  // Kite allows 3 requests per second for historical data, so we fetch in sequence
  for (const token of tokens) {
    try {
      // @ts-expect-error - 'oi' is supported in the underlying API
      const data = await kc.getHistoricalData(token, "day", from, to, false, true)
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
