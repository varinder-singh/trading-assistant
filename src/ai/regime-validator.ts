export interface ValidationCheck {
  name: string
  passed: boolean
  reason?: string
}

export interface ValidationResult {
  activeAgent: string
  wasOverridden: boolean
  checks: ValidationCheck[]
}

export function validateRegime(orchestrator: any, marketContext: any): ValidationResult {
  const result: ValidationResult = {
    activeAgent: orchestrator.activeAgent,
    wasOverridden: false,
    checks: []
  }

  // 1. VIX Safety Filter
  const vix = marketContext.vix?.current || 0
  const vixCheck: ValidationCheck = {
    name: "VIX Safety Filter",
    passed: vix <= 25,
    reason: vix > 25 ? `VIX is too high (${vix.toFixed(2)}) for TREND` : undefined
  }
  result.checks.push(vixCheck)

  if (!vixCheck.passed && result.activeAgent === "TREND") {
    result.activeAgent = "SCALPER"
    result.wasOverridden = true
  }

  // 2. Trend Alignment Check (Advisory)
  const tf15m = marketContext.tf15m
  const tf1h = marketContext.tf1h
  if (tf15m && tf1h) {
    const trendAlignmentCheck: ValidationCheck = {
      name: "Trend Alignment Check",
      passed: tf15m.trend === tf1h.trend || tf1h.trend === "neutral",
      reason: (tf15m.trend !== tf1h.trend && tf1h.trend !== "neutral") 
        ? `Timeframes are out of alignment (15m: ${tf15m.trend}, 1h: ${tf1h.trend})` 
        : undefined
    }
    result.checks.push(trendAlignmentCheck)
  }

  return result
}
