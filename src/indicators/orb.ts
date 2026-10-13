import type { Candle, OpeningRange } from '../types/analysis.js'

/**
 * Calculates the Opening Range (9:15 AM - 9:45 AM) from a set of candles.
 * For NIFTY, the market opens at 09:15.
 */
export function calculateORB(candles: Candle[]): OpeningRange | null {
  const formatter = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })

  // Find candles between 09:15 and 09:45 (inclusive)
  const orCandles = candles.filter((c) => {
    const timeStr = formatter.format(new Date(c.time))
    return timeStr >= '09:15' && timeStr <= '09:45'
  })

  if (orCandles.length === 0) return null

  const high = Math.max(...orCandles.map((c) => c.high))
  const low = Math.min(...orCandles.map((c) => c.low))

  // Check if current price (last candle) has broken the ORB
  const lastCandle = candles[candles.length - 1]
  if (!lastCandle) return { high, low, broken: 'INSIDE' }

  const lastPrice = lastCandle.close
  const broken: 'UP' | 'DOWN' | 'INSIDE' = lastPrice > high ? 'UP' : lastPrice < low ? 'DOWN' : 'INSIDE'

  return { high, low, broken }
}
