import type { Candle } from "../types/analysis.js"

/**
 * Calculates the Average True Range (ATR) for a given period.
 * ATR = RMA(True Range, period)
 * RMA (Running Moving Average) is used by TradingView/Pine Script for ATR.
 */
export function calculateATR(candles: Candle[], period: number = 14): number {
  if (candles.length <= period) return 0

  const trueRanges: number[] = []

  for (let i = 1; i < candles.length; i++) {
    const current = candles[i]
    const previous = candles[i - 1]
    if (!current || !previous) continue

    const high = current.high
    const low = current.low
    const prevClose = previous.close

    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose))
    trueRanges.push(tr)
  }

  // Calculate the first ATR as the simple mean of the first 'period' True Ranges
  let atr = trueRanges.slice(0, period).reduce((a, b) => a + b, 0) / period

  // Use the RMA formula for the rest:
  // currentATR = (prevATR * (period - 1) + currentTR) / period
  for (let i = period; i < trueRanges.length; i++) {
    const tr = trueRanges[i]
    if (tr !== undefined) {
      atr = (atr * (period - 1) + tr) / period
    }
  }

  return atr
}
