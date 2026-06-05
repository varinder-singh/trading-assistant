import type { Candle, SwingPoint } from "../types/analysis.js"

/**
 * Identifies local swing highs and lows using a basic fractal approach.
 * A high is a peak if it is higher than its neighbors.
 * A low is a trough if it is lower than its neighbors.
 */
export function calculateSwings(candles: Candle[], lookback: number = 2): SwingPoint[] {
  const swings: SwingPoint[] = []

  for (let i = lookback; i < candles.length - lookback; i++) {
    const current = candles[i]
    if (!current) continue

    let isHigh = true
    let isLow = true

    for (let j = 1; j <= lookback; j++) {
      const prev = candles[i - j]
      const next = candles[i + j]
      if (!prev || !next) {
        isHigh = false
        isLow = false
        break
      }

      if (prev.high >= current.high || next.high > current.high) {
        isHigh = false
      }
      if (prev.low <= current.low || next.low < current.low) {
        isLow = false
      }
    }

    if (isHigh) {
      swings.push({ type: "HIGH", price: current.high, time: current.time })
    } else if (isLow) {
      swings.push({ type: "LOW", price: current.low, time: current.time })
    }
  }

  return swings
}
