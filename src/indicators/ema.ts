import type { Candle } from '../types/analysis.js'

/**
 * Calculates the Exponential Moving Average (EMA) for a given period.
 * EMA = (Close - Previous EMA) * multiplier + Previous EMA
 * Multiplier = 2 / (period + 1)
 */
export function calculateEMA(candles: Candle[], period: number): number {
  if (candles.length < period) {
    // Fallback to SMA for initial calculation if not enough data
    const sum = candles.reduce((acc, c) => acc + c.close, 0)
    return sum / candles.length
  }

  const multiplier = 2 / (period + 1)

  // Start with SMA for the first 'period' candles
  let ema = candles.slice(0, period).reduce((acc, c) => acc + c.close, 0) / period

  // Iterate from there to calculate EMA
  for (let i = period; i < candles.length; i++) {
    const candle = candles[i]
    if (!candle) continue
    ema = (candle.close - ema) * multiplier + ema
  }

  return ema
}

/**
 * Calculates the slope of the EMA over the last N candles.
 * Returns the angle in degrees (-90 to 90).
 */
export function calculateEMASlope(candles: Candle[], period: number, lookback: number = 3): number {
  if (candles.length < period + lookback) return 0

  const emaValues: number[] = []
  for (let i = candles.length - lookback; i <= candles.length; i++) {
    const subCandles = candles.slice(0, i)
    if (subCandles.length >= period) {
      emaValues.push(calculateEMA(subCandles, period))
    }
  }

  if (emaValues.length < 2) return 0

  const first = emaValues[0]!
  const last = emaValues[emaValues.length - 1]!
  if (first === 0) return 0
  const pctChange = ((last - first) / first) * 1000 // scale up for angle representation

  const angleRad = Math.atan(pctChange)
  const angleDeg = (angleRad * 180) / Math.PI

  return angleDeg
}
