import type { Candle } from "../types/analysis.js"

export function calculateVWAP(candles: Candle[]): number {
  let cumulativePV = 0
  let cumulativeVolume = 0
  let lastDate: string | undefined = undefined

  for (const c of candles) {
    const currentDate = new Date(c.time * 1000).toISOString().split('T')[0]
    
    // Reset VWAP daily at start of market hours
    if (currentDate !== lastDate) {
      cumulativePV = 0
      cumulativeVolume = 0
      lastDate = currentDate
    }

    const typicalPrice = (c.high + c.low + c.close) / 3
    cumulativePV += typicalPrice * c.volume
    cumulativeVolume += c.volume
  }

  if (cumulativeVolume === 0) {
    return 0
  }

  return cumulativePV / cumulativeVolume
}
