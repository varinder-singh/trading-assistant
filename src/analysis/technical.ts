import type { Candle, TechnicalAnalysis } from '../types/analysis.js'
import { detectTrend } from '../indicators/trend.js'
import { calculateVWAP, calculateVWAPZScore } from '../indicators/vwap.js'
import { calculateRSI } from '../indicators/rsi.js'

import { calculateATR } from '../indicators/atr.js'
import { calculateEMA, calculateEMASlope } from '../indicators/ema.js'
import { calculateORB } from '../indicators/orb.js'
import { calculateSwings } from '../indicators/swings.js'
import { detectWaveStructure } from '../indicators/waves.js'
import type { DailyContext } from '../types/technical-analysis.js'
import { calculateVolumeProfile } from '../indicators/volume-profile.js'
import { calculateADX } from '../indicators/adx.js'

export function analyzeDailyContext(candles1d: Candle[], intradayCandles?: Candle[]): DailyContext | null {
  if (candles1d.length < 15) return null

  const atr14 = calculateATR(candles1d, 14)
  const prevDay = candles1d[candles1d.length - 2]
  const currentDay = candles1d[candles1d.length - 1]

  if (!prevDay || !currentDay) return null

  const pdh = prevDay.high
  const pdl = prevDay.low
  const pdc = prevDay.close
  const pdr = pdh - pdl

  const isCompression = pdr < 0.7 * atr14
  const openingRange = calculateORB(candles1d) ?? undefined

  let previousDayVolumeProfile = undefined
  if (intradayCandles && intradayCandles.length > 0) {
    const prevDayStart = prevDay.time
    const currentDayStart = currentDay.time

    const prevDayIntraday = intradayCandles.filter((c) => c.time >= prevDayStart && c.time < currentDayStart)

    if (prevDayIntraday.length > 0) {
      previousDayVolumeProfile = calculateVolumeProfile(prevDayIntraday, 5) ?? undefined // 5 points tick size default
    }
  }

  return {
    atr14,
    pdh,
    pdl,
    pdc,
    pdr,
    isCompression,
    currentDayOpen: currentDay.open,
    openingRange,
    previousDayVolumeProfile,
  }
}

export function analyzeTechnical(
  candles: Candle[],
  timeframe: string = '15m',
  emaPeriods: number[] = []
): TechnicalAnalysis {
  if (candles.length === 0) {
    throw new Error('Cannot analyze technical indicators without candles')
  }

  const trend = detectTrend(candles)
  const vwap = calculateVWAP(candles)
  const rsi = calculateRSI(candles)

  const lastCandle = candles[candles.length - 1]!
  const last = lastCandle.close

  const highs = candles.slice(-20).map((c) => c.high)
  const lows = candles.slice(-20).map((c) => c.low)

  const resistance = Math.max(...highs)
  const support = Math.min(...lows)

  const vwapPosition = last > vwap ? 'above' : 'below'

  const ema: Record<string, number> = {}
  const emaSlope: Record<string, number> = {}
  for (const period of emaPeriods) {
    ema[period] = calculateEMA(candles, period)
    emaSlope[period] = calculateEMASlope(candles, period)
  }

  const vwapZScore = calculateVWAPZScore(candles, vwap)
  const adx = timeframe === '15m' ? calculateADX(candles, 14) : undefined

  const swings = timeframe === '15m' ? calculateSwings(candles, 2) : undefined
  const waveContext = timeframe === '15m' && swings ? detectWaveStructure(swings, last) : undefined
  const openingRange = timeframe === '15m' ? (calculateORB(candles) ?? undefined) : undefined

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
    swings,
    waveContext,
    openingRange,
    vwapZScore,
    emaSlope,
    adx,
  }
}

export function analyzeMultiTimeframe(
  candles1h: Candle[],
  candles30m: Candle[],
  candles15m: Candle[],
  candles3m: Candle[]
) {
  const tf1h = analyzeTechnical(candles1h, '1h', [50, 200])
  const tf30m = analyzeTechnical(candles30m, '30m', [9, 21])
  const tf15m = analyzeTechnical(candles15m, '15m', [9, 21])
  const tf3m = analyzeTechnical(candles3m, '3m', [9]) // 9 EMA for trigger momentum

  return {
    tf1h,
    tf30m,
    tf15m,
    tf3m,
  }
}
