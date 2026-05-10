import type { Candle } from "../types/analysis.js"

export function calculateRSI(candles: Candle[], period = 14): number {
  if (candles.length < period + 1) return 50

  const recentCandles = candles.slice(candles.length - period - 1)
  const previousCandles = recentCandles.slice(0, -1)
  const currentCandles = recentCandles.slice(1)

  const priceChanges = currentCandles.map((candle, index) => {
    const previousCandle = previousCandles[index]!
    return candle.close - previousCandle.close
  })

  const gains = priceChanges
    .filter((change) => change > 0)
    .reduce((total, change) => total + change, 0)
  const losses = priceChanges
    .filter((change) => change < 0)
    .reduce((total, change) => total + Math.abs(change), 0)

  const avgGain = gains / period
  const avgLoss = losses / period

  if (avgLoss === 0) return 100

  const rs = avgGain / avgLoss
  return Number((100 - 100 / (1 + rs)).toFixed(2))
}

