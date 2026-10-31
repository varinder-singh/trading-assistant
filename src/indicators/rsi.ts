import type { Candle } from '../types/analysis.js'

/**
 * Calculates Wilder's Relative Strength Index (RSI) using Wilder's RMA smoothing:
 * - First `period` price changes seed the initial simple average gain and loss.
 * - Subsequent price changes apply Wilder's recursive smoothing:
 *   avgGain = (prevAvgGain * (period - 1) + currentGain) / period
 */
export function calculateRSI(candles: Candle[], period = 14): number {
  if (candles.length < period + 1) return 50

  const priceChanges = candles.slice(1).map((candle, index) => candle.close - candles[index]!.close)
  const seedChanges = priceChanges.slice(0, period)
  const remainingChanges = priceChanges.slice(period)

  const initialAvgGain = seedChanges.filter((c) => c > 0).reduce((sum, c) => sum + c, 0) / period
  const initialAvgLoss = seedChanges.filter((c) => c < 0).reduce((sum, c) => sum + Math.abs(c), 0) / period

  const { avgGain, avgLoss } = remainingChanges.reduce(
    (acc, change) => {
      const gain = change > 0 ? change : 0
      const loss = change < 0 ? Math.abs(change) : 0
      return {
        avgGain: (acc.avgGain * (period - 1) + gain) / period,
        avgLoss: (acc.avgLoss * (period - 1) + loss) / period,
      }
    },
    { avgGain: initialAvgGain, avgLoss: initialAvgLoss }
  )

  if (avgLoss === 0) return 100

  const rs = avgGain / avgLoss
  return Number((100 - 100 / (1 + rs)).toFixed(2))
}
