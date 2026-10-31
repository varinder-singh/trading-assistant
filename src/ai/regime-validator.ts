export interface ValidationCheck {
  name: string
  passed: boolean
  reason?: string | undefined
}

export interface ValidationResult {
  activeAgent: string
  wasOverridden: boolean
  checks: ValidationCheck[]
}

export class RegimeValidator {
  public validate(orchestrator: any, marketContext: any): ValidationResult {
    const vixCheck = this.evaluateVixSafety(marketContext.vix?.current || 0)
    const trendCheck = this.evaluateTrendAlignment(marketContext.tf15m, marketContext.tf1h)
    const adxCheck = this.evaluateAdxStrength(marketContext.tf15m, marketContext.dailyContext)
    const rsiCheck = this.evaluateRsiExhaustion(marketContext.tf15m)
    const deadZoneCheck = this.evaluateDeadZone(marketContext.time, marketContext.tf15m)
    const waveCheck = this.evaluateCorrectiveWave(marketContext.tf15m)

    const checks = [vixCheck, trendCheck, adxCheck, rsiCheck, deadZoneCheck, waveCheck].filter(
      (check): check is ValidationCheck => check !== null
    )

    const isOverridden = orchestrator.activeAgent === 'TREND' && checks.some((check) => !check.passed)
    const activeAgent = isOverridden ? 'SCALPER' : orchestrator.activeAgent

    return {
      activeAgent,
      wasOverridden: isOverridden,
      checks,
    }
  }

  private evaluateVixSafety(vix: number): ValidationCheck {
    return {
      name: 'VIX Safety Filter',
      passed: vix <= 25,
      reason: vix > 25 ? `VIX is too high (${vix.toFixed(2)}) for TREND` : `VIX under threshold (${vix.toFixed(2)})`,
    }
  }

  private evaluateTrendAlignment(tf15m: any, tf1h: any): ValidationCheck | null {
    if (!tf15m || !tf1h) return null

    const passed = tf15m.trend === tf1h.trend || tf1h.trend === 'sideways' || tf1h.trend === 'neutral'
    const reason = !passed ? `Timeframes are out of alignment (15m: ${tf15m.trend}, 1h: ${tf1h.trend})` : ''

    return {
      name: 'Trend Alignment Check',
      passed,
      reason,
    }
  }

  private evaluateAdxStrength(tf15m: any, dailyContext: any): ValidationCheck | null {
    if (!tf15m?.adx) return null

    const adxValue = Number(tf15m.adx.adx ?? 0)
    const isWave3 = tf15m.waveContext?.currentPhase === 'WAVE_3'
    const isCompressedBreakout = Boolean(dailyContext?.isCompression) && tf15m.openingRange?.broken !== 'INSIDE'
    const passed = adxValue >= 20 || isWave3 || isCompressedBreakout

    return {
      name: 'ADX Trend Strength Filter',
      passed,
      reason: passed ? '' : `15m ADX (${adxValue.toFixed(1)}) < 20 indicates range-bound chop`,
    }
  }

  private evaluateRsiExhaustion(tf15m: any): ValidationCheck | null {
    if (typeof tf15m?.rsi !== 'number') return null

    const rsi = tf15m.rsi
    const isWave3 = tf15m.waveContext?.currentPhase === 'WAVE_3'
    const passed = isWave3 || (rsi <= 75 && rsi >= 25)

    return {
      name: 'RSI Exhaustion Filter',
      passed,
      reason: passed ? '' : `15m RSI (${rsi.toFixed(1)}) is in extreme exhaustion outside Wave 3`,
    }
  }

  private evaluateDeadZone(timeStr: string | undefined, tf15m: any): ValidationCheck | null {
    if (!timeStr) return null

    const hhmm = timeStr.slice(0, 5)
    const isInDeadZone = hhmm >= '11:30' && hhmm <= '13:00'
    const isWave3 = tf15m?.waveContext?.currentPhase === 'WAVE_3'
    const passed = !isInDeadZone || isWave3

    return {
      name: 'IST Dead-Zone Filter',
      passed,
      reason: passed ? '' : `IST time ${hhmm} is inside 11:30-13:00 dead zone without active Wave 3`,
    }
  }

  private evaluateCorrectiveWave(tf15m: any): ValidationCheck | null {
    const phase = tf15m?.waveContext?.currentPhase
    if (!phase) return null

    const passed = phase !== 'ABC_CORRECTION'
    return {
      name: 'Corrective Wave Filter',
      passed,
      reason: passed ? '' : '15m structure is in ABC_CORRECTION; TREND agent forbidden',
    }
  }
}

export const regimeValidator = new RegimeValidator()
export const validateRegime = (orchestrator: any, marketContext: any): ValidationResult =>
  regimeValidator.validate(orchestrator, marketContext)
