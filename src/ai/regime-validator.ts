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
    const isOverridden = !vixCheck.passed && orchestrator.activeAgent === 'TREND'
    const activeAgent = isOverridden ? 'SCALPER' : orchestrator.activeAgent

    const trendCheck = this.evaluateTrendAlignment(marketContext.tf15m, marketContext.tf1h)
    const checks = trendCheck ? [vixCheck, trendCheck] : [vixCheck]

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

    const passed = tf15m.trend === tf1h.trend || tf1h.trend === 'neutral'
    const reason = !passed ? `Timeframes are out of alignment (15m: ${tf15m.trend}, 1h: ${tf1h.trend})` : ''

    return {
      name: 'Trend Alignment Check',
      passed,
      reason,
    }
  }
}

export const regimeValidator = new RegimeValidator()
export const validateRegime = (orchestrator: any, marketContext: any): ValidationResult =>
  regimeValidator.validate(orchestrator, marketContext)
