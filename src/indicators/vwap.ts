import type { Candle } from '../types/analysis.js'

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

export function calculateVWAPZScore(candles: Candle[], vwap: number): number {
  if (candles.length === 0 || vwap === 0) return 0
  const lastN = candles.slice(-20)
  const typicalPrices = lastN.map((c) => (c.high + c.low + c.close) / 3)
  const mean = typicalPrices.reduce((a, b) => a + b, 0) / typicalPrices.length
  const variance = typicalPrices.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / typicalPrices.length
  const stdDev = Math.sqrt(variance)
  if (stdDev === 0) return 0
  const currentPrice = candles[candles.length - 1]!.close
  return (currentPrice - vwap) / stdDev
}
