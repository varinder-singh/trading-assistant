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
    return candles.length > 0 ? sum / candles.length : 0
  }

  const multiplier = 2 / (period + 1)
  const initialSma = candles.slice(0, period).reduce((acc, c) => acc + c.close, 0) / period

  return candles.slice(period).reduce((ema, candle) => (candle.close - ema) * multiplier + ema, initialSma)
}

/**
 * Calculates the slope of the EMA over the last N candles.
 * Returns the angle in degrees (-90 to 90).
 */
export function calculateEMASlope(candles: Candle[], period: number, lookback: number = 3): number {
  if (candles.length < period + lookback) return 0

  const sliceIndices = Array.from({ length: lookback + 1 }, (_, idx) => candles.length - lookback + idx)
  const emaValues = sliceIndices
    .map((i) => candles.slice(0, i))
    .filter((sub) => sub.length >= period)
    .map((sub) => calculateEMA(sub, period))

  if (emaValues.length < 2) return 0

  const first = emaValues[0]!
  const last = emaValues[emaValues.length - 1]!
  if (first === 0) return 0

  const pctChange = ((last - first) / first) * 1000 // scale up for angle representation
  const angleRad = Math.atan(pctChange)
  return (angleRad * 180) / Math.PI
}
