import type { Candle } from "../types/analysis.js"

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
    ema = (candles[i].close - ema) * multiplier + ema
  }

  return ema
}
