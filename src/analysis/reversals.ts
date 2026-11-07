import type { TradeTechnicalAnalysis, Candle } from '../types/analysis.js'

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

export class ReversalScoreCalculator {
  public calculate(analysis: TradeTechnicalAnalysis, direction: 'BULLISH' | 'BEARISH'): ReversalScoreResult {
    const triggerTf = analysis.tf5m
    const triggerCandles = analysis.candles5m
    const { tf15m, optionsAnalysis, dailyContext } = analysis
    const currentPrice = triggerTf.price
    const tolerance = currentPrice * 0.001

    const optionsDefense =
      direction === 'BULLISH'
        ? optionsAnalysis.atmPutOI > optionsAnalysis.atmCallOI * 1.5 ||
          optionsAnalysis.marketFlow === 'LONG_BUILDUP' ||
          optionsAnalysis.marketFlow === 'SHORT_COVERING'
        : optionsAnalysis.atmCallOI > optionsAnalysis.atmPutOI * 1.5 ||
          optionsAnalysis.marketFlow === 'SHORT_BUILDUP' ||
          optionsAnalysis.marketFlow === 'LONG_UNWINDING'

    const vwapInteraction = Math.abs(currentPrice - triggerTf.vwap) < tolerance

    const volumeClimax = this.isVolumeClimax(triggerCandles)

    const structuralLevel = this.isNearStructure(direction, currentPrice, tolerance, tf15m, dailyContext)

    const institutionalFlow = this.isInstitutionalFlowAligned(direction, triggerTf.gtiScore || tf15m.gtiScore)

    const breakdown = {
      optionsDefense,
      vwapInteraction,
      volumeClimax,
      structuralLevel,
      institutionalFlow,
    }

    const score = Object.values(breakdown).filter(Boolean).length

    return { score, maxScore: 5, breakdown }
  }

  private isVolumeClimax(candles: Candle[]): boolean {
    if (candles.length < 2) return false
    const currentCandle = candles[candles.length - 1]
    const avgVolume = candles.slice(0, -1).reduce((sum, c) => sum + c.volume, 0) / (candles.length - 1)
    return !!(currentCandle && currentCandle.volume > avgVolume * 1.5)
  }

  private isNearStructure(
    direction: 'BULLISH' | 'BEARISH',
    currentPrice: number,
    tolerance: number,
    tf15m: TradeTechnicalAnalysis['tf15m'],
    dailyContext: TradeTechnicalAnalysis['dailyContext']
  ): boolean {
    const classicMatch =
      direction === 'BULLISH'
        ? Math.abs(currentPrice - tf15m.support) < tolerance
        : Math.abs(currentPrice - tf15m.resistance) < tolerance

    if (classicMatch) return true

    const vp = dailyContext?.previousDayVolumeProfile
    return vp ? [vp.poc, vp.vah, vp.val].some((level) => Math.abs(currentPrice - level) < tolerance) : false
  }

  private isInstitutionalFlowAligned(
    direction: 'BULLISH' | 'BEARISH',
    gti?: TradeTechnicalAnalysis['tf5m']['gtiScore']
  ): boolean {
    if (!gti) return false
    return direction === 'BULLISH' ? gti.composite > 0.3 : gti.composite < -0.3
  }
}

export const reversalScoreCalculator = new ReversalScoreCalculator()
export const calculateReversalScore = (
  analysis: TradeTechnicalAnalysis,
  direction: 'BULLISH' | 'BEARISH'
): ReversalScoreResult => reversalScoreCalculator.calculate(analysis, direction)
