import type { TradeTechnicalAnalysis, VolumeProfile } from "../types/analysis.js"
import type { KiteOptionsAnalysis } from "./kite-options.js"

export interface ReversalScoreResult {
  score: number
  maxScore: number
  breakdown: {
    optionsDefense: boolean
    vwapInteraction: boolean
    volumeClimax: boolean
    structuralLevel: boolean
    institutionalFlow: boolean
  }
}

export function calculateReversalScore(
  analysis: TradeTechnicalAnalysis,
  direction: "BULLISH" | "BEARISH"
): ReversalScoreResult {
  let score = 0
  const breakdown = {
    optionsDefense: false,
    vwapInteraction: false,
    volumeClimax: false,
    structuralLevel: false,
    institutionalFlow: false,
  }

  const { tf3m, tf15m, optionsAnalysis, dailyContext, candles3m } = analysis
  const currentPrice = tf3m.price
  const tolerance = currentPrice * 0.001 // 0.1% tolerance for levels

  // 1. Options OI Defense (+1)
  if (direction === "BULLISH") {
    // Bullish reversal: Put writers should be defending
    if (
      optionsAnalysis.atmPutOI > optionsAnalysis.atmCallOI * 1.5 ||
      optionsAnalysis.marketFlow === "LONG_BUILDUP" ||
      optionsAnalysis.marketFlow === "SHORT_COVERING"
    ) {
      breakdown.optionsDefense = true
      score++
    }
  } else {
    // Bearish reversal: Call writers should be defending
    if (
      optionsAnalysis.atmCallOI > optionsAnalysis.atmPutOI * 1.5 ||
      optionsAnalysis.marketFlow === "SHORT_BUILDUP" ||
      optionsAnalysis.marketFlow === "LONG_UNWINDING"
    ) {
      breakdown.optionsDefense = true
      score++
    }
  }

  // 2. VWAP Interaction (+1)
  // Check if current price is bouncing off VWAP
  if (Math.abs(currentPrice - tf3m.vwap) < tolerance) {
    breakdown.vwapInteraction = true
    score++
  }

  // 3. Volume Climax / Absorption (+1)
  if (candles3m.length >= 2) {
    const currentCandle = candles3m[candles3m.length - 1]
    const avgVolume = candles3m.slice(0, -1).reduce((sum, c) => sum + c.volume, 0) / (candles3m.length - 1)

    if (currentCandle && currentCandle.volume > avgVolume * 1.5) {
      breakdown.volumeClimax = true
      score++
    }
  }

  // 4. Structural Levels / Volume Profile (+1)
  let nearStructure = false

  // Check classic support/resistance
  if (direction === "BULLISH" && Math.abs(currentPrice - tf15m.support) < tolerance) nearStructure = true
  if (direction === "BEARISH" && Math.abs(currentPrice - tf15m.resistance) < tolerance) nearStructure = true

  // Check Volume Profile levels (POC, VAH, VAL)
  if (dailyContext?.previousDayVolumeProfile) {
    const vp = dailyContext.previousDayVolumeProfile
    const nearVP = [vp.poc, vp.vah, vp.val].some((level) => Math.abs(currentPrice - level) < tolerance)
    if (nearVP) nearStructure = true
  }

  if (nearStructure) {
    breakdown.structuralLevel = true
    score++
  }

  // 5. GTI / Institutional Flow (+1)
  const gti = tf3m.gtiScore || tf15m.gtiScore
  if (gti) {
    if (direction === "BULLISH" && gti.composite > 0.3) {
      breakdown.institutionalFlow = true
      score++
    } else if (direction === "BEARISH" && gti.composite < -0.3) {
      breakdown.institutionalFlow = true
      score++
    }
  }

  return { score, maxScore: 5, breakdown }
}
