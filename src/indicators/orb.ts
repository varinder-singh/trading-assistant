import type { Candle, OpeningRange } from '../types/analysis.js'

const istTimeFormatter = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

const istDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
})

/**
 * Calculates the Opening Range (09:15 AM - 09:45 AM IST) strictly for the latest trading day.
 * Candle timestamps represent bar open times: for 15m/3m bars, start times in ['09:15', '09:45')
 * cover the 09:15–09:45 window without bleeding into the 09:45–10:00 candle or prior days.
 */
export function calculateORB(candles: Candle[]): OpeningRange | null {
  if (candles.length === 0) return null

  const lastCandle = candles[candles.length - 1]!
  const targetDateKey = istDateFormatter.format(new Date(lastCandle.time))

  const sameDayCandles = candles.filter((c) => istDateFormatter.format(new Date(c.time)) === targetDateKey)
  const orCandles = sameDayCandles.filter((c) => {
    const timeStr = istTimeFormatter.format(new Date(c.time))
    return timeStr >= '09:15' && timeStr < '09:45'
  })

  if (orCandles.length === 0) return null

  const high = Math.max(...orCandles.map((c) => c.high))
  const low = Math.min(...orCandles.map((c) => c.low))
  const lastPrice = lastCandle.close
  const broken: 'UP' | 'DOWN' | 'INSIDE' = lastPrice > high ? 'UP' : lastPrice < low ? 'DOWN' : 'INSIDE'

  return { high, low, broken }
}
