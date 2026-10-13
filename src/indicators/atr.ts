import type { Candle } from '../types/analysis.js'

/**
 * Calculates the Average True Range (ATR) for a given period.
 * ATR = RMA(True Range, period)
 * RMA (Running Moving Average) is used by TradingView/Pine Script for ATR.
 */
export function calculateATR(candles: Candle[], period: number = 14): number {
  if (candles.length <= period) return 0

  const trueRanges = candles.slice(1).map((current, idx) => {
    const previous = candles[idx]!
    const tr1 = current.high - current.low
    const tr2 = Math.abs(current.high - previous.close)
    const tr3 = Math.abs(current.low - previous.close)
    return Math.max(tr1, tr2, tr3)
  })

  // Calculate the first ATR as the simple mean of the first 'period' True Ranges
  const initialAtr = trueRanges.slice(0, period).reduce((sum, tr) => sum + tr, 0) / period

  // Use the RMA formula for the rest:
  // currentATR = (prevATR * (period - 1) + currentTR) / period
  return trueRanges.slice(period).reduce((atr, tr) => (atr * (period - 1) + tr) / period, initialAtr)
}
