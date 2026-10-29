import type { Candle, SwingPoint } from '../types/analysis.js'

/**
 * Identifies local swing highs and lows using a basic fractal approach.
 * A high is a peak if it is higher than its neighbors.
 * A low is a trough if it is lower than its neighbors.
 */
export function calculateSwings(candles: Candle[], lookback: number = 2): SwingPoint[] {
  if (candles.length < lookback * 2 + 1) return []

  const indices = Array.from({ length: candles.length - lookback * 2 }, (_, idx) => idx + lookback)

  return indices.flatMap((i): SwingPoint[] => {
    const current = candles[i]
    if (!current) return []

    const lookbackRange = Array.from({ length: lookback }, (_, j) => j + 1)
    const neighbors = lookbackRange.map((j) => ({
      prev: candles[i - j],
      next: candles[i + j],
    }))

    const valid = neighbors.every((n) => n.prev && n.next)
    if (!valid) return []

    const isHigh = neighbors.every((n) => n.prev!.high < current.high && n.next!.high <= current.high)
    const isLow = neighbors.every((n) => n.prev!.low > current.low && n.next!.low >= current.low)

    if (isHigh) return [{ type: 'HIGH', price: current.high, time: current.time }]
    if (isLow) return [{ type: 'LOW', price: current.low, time: current.time }]
    return []
  })
}
