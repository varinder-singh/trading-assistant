import type { Candle } from "../types/analysis.js"
import { detectTrend } from "../indicators/trend.js"
import { calculateVWAP } from "../indicators/vwap.js"
import { calculateRSI } from "../indicators/rsi.js"

import { calculateEMA } from "../indicators/ema.js"

export type TechnicalAnalysis = {
  trend: string
  support: number
  resistance: number
  vwap: number
  vwapPosition: string
  price: number
  rsi: number
  timeframe?: string
  ema?: Record<string, number>
}

export function analyzeTechnical(candles: Candle[], timeframe: string = "15m", emaPeriods: number[] = []): TechnicalAnalysis {
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

  const ema: Record<string, number> = {}
  for (const period of emaPeriods) {
    ema[period] = calculateEMA(candles, period)
  }

  return {
    trend,
    support,
    resistance,
    vwap,
    vwapPosition,
    price: last,
    rsi,
    timeframe,
    ema,
  }
}

export function analyzeMultiTimeframe(candles1h: Candle[], candles15m: Candle[], candles3m: Candle[]) {
  const tf1h = analyzeTechnical(candles1h, "1h", [50, 200])
  const tf15m = analyzeTechnical(candles15m, "15m", [9, 21])
  const tf3m = analyzeTechnical(candles3m, "3m", [9]) // 9 EMA for trigger momentum

  return {
    tf1h,
    tf15m,
    tf3m,
  }
}
