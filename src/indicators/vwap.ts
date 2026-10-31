import type { Candle } from '../types/analysis.js'

export function calculateVWAP(candles: Candle[]): number {
  if (candles.length === 0) return 0

  const getTimeMs = (time: number) => (time > 1e11 ? time : time * 1000)
  const getDateStr = (time: number) => new Date(getTimeMs(time)).toISOString().split('T')[0]

  const lastCandle = candles[candles.length - 1]!
  const lastDate = getDateStr(lastCandle.time)
  const todayCandles = candles.filter((c) => getDateStr(c.time) === lastDate)

  const { cumulativePV, cumulativeVolume } = todayCandles.reduce(
    (acc, c) => {
      const typicalPrice = (c.high + c.low + c.close) / 3
      return {
        cumulativePV: acc.cumulativePV + typicalPrice * c.volume,
        cumulativeVolume: acc.cumulativeVolume + c.volume,
      }
    },
    { cumulativePV: 0, cumulativeVolume: 0 }
  )

  return cumulativeVolume === 0 ? 0 : cumulativePV / cumulativeVolume
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
