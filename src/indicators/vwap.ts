import type { Candle } from "../types/analysis.js"

export function calculateVWAP(candles: Candle[]): number {
  let cumulativePV = 0
  let cumulativeVolume = 0

  for (const c of candles) {
    const typicalPrice = (c.high + c.low + c.close) / 3
    cumulativePV += typicalPrice * c.volume
    cumulativeVolume += c.volume
  }

  if (cumulativeVolume === 0) {
    return 0
  }

  return cumulativePV / cumulativeVolume
}
