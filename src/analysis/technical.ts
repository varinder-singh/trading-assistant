import type { Candle } from "../types/analysis.js"
import { detectTrend } from "../indicators/trend.js"
import { calculateVWAP } from "../indicators/vwap.js"
import { calculateRSI } from "../indicators/rsi.js"

import { calculateATR } from "../indicators/atr.js"
import { calculateEMA } from "../indicators/ema.js"

export function analyzeDailyContext(candles1d: Candle[]) {
  if (candles1d.length < 15) return null

  const atr14 = calculateATR(candles1d, 14)
  const prevDay = candles1d[candles1d.length - 2]
  const currentDay = candles1d[candles1d.length - 1]

  if (!prevDay || !currentDay) return null

  const pdh = prevDay.high
  const pdl = prevDay.low
  const pdc = prevDay.close
  const pdr = pdh - pdl

  const isCompression = pdr < (0.7 * atr14)

  return {
    atr14,
    pdh,
    pdl,
    pdc,
    pdr,
    isCompression,
    currentDayOpen: currentDay.open
  }
}

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
