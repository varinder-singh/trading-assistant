import type { Candle } from "../types/analysis.js"
import { detectTrend } from "../indicators/trend.js"
import { calculateVWAP } from "../indicators/vwap.js"
import { calculateRSI } from "../indicators/rsi.js"

export type TechnicalAnalysis = {
  trend: string
  support: number
  resistance: number
  vwap: number
  vwapPosition: string
  price: number
  rsi: number
  timeframe?: string
}

export function analyzeTechnical(candles: Candle[], timeframe: string = "15m"): TechnicalAnalysis {
  if (candles.length === 0) {
    throw new Error("Cannot analyze technical indicators without candles")
  }

  const trend = detectTrend(candles)
  const vwap = calculateVWAP(candles)
  const rsi = calculateRSI(candles)

  const lastCandle = candles[candles.length - 1]!
  const last = lastCandle.close

  const highs = candles.slice(-20).map(c => c.high)
  const lows = candles.slice(-20).map(c => c.low)

  const resistance = Math.max(...highs)
  const support = Math.min(...lows)

  const vwapPosition = last > vwap ? "above" : "below"

  return {
    trend,
    support,
    resistance,
    vwap,
    vwapPosition,
    price: last,
    rsi,
    timeframe,
  }
}

export function analyzeDualTimeframe(candles15m: Candle[], candles5m: Candle[]) {
  const analysis15m = analyzeTechnical(candles15m, "15m")
  const analysis5m = analyzeTechnical(candles5m, "5m")

  return {
    tf15m: analysis15m,
    tf5m: analysis5m,
  }
}
