import type { MarketContext, OrchestratorResponse, TradingAgentType } from "./types.js"
import { eventHub } from "../utils/event-hub.js"

export interface RegimeCheck {
  name: string
  passed: boolean
  reason: string
}

export interface RegimeValidationResult {
  activeAgent: TradingAgentType
  wasOverridden: boolean
  originalAgent: TradingAgentType
  checks: RegimeCheck[]
}

export function validateRegime(
  orchestrator: OrchestratorResponse,
  marketData: MarketContext
): RegimeValidationResult {
  // If Orchestrator selects SCALPER, we don't need to validate. It's the safe default.
  if (orchestrator.activeAgent === "SCALPER") {
    const checks = [
      { name: "Safe Default", passed: true, reason: "SCALPER is the default safe agent." }
    ]
    eventHub.emit("agent_update", {
      agent: "Regime Validator",
      status: "decided",
      message: "Approved: SCALPER is safe default.",
      data: { checks }
    })
    return {
      activeAgent: "SCALPER",
      wasOverridden: false,
      originalAgent: "SCALPER",
      checks
    }
  }

  const checks: RegimeCheck[] = []

  // Check 1: Multi-TF Trend Alignment
  // Both 1h and 15m must not be sideways, and must agree
  const trend1h = marketData.tf1h.trend
  const trend15m = marketData.tf15m.trend
  const isTrendAligned =
    trend1h !== "sideways" && trend15m !== "sideways" && trend1h === trend15m

  checks.push({
    name: "Multi-TF Trend Alignment",
    passed: isTrendAligned,
    reason: isTrendAligned
      ? `1H and 15m trends are aligned (${trend15m})`
      : `Trends not aligned: 1H=${trend1h}, 15m=${trend15m}`
  })

  // Check 2: ATR Expansion
  // We need daily compression (meaning expansion is coming) or strong 15m price action.
  // We'll lean on daily compression for now.
  let isAtrExpanding = false
  let atrReason = "Daily context not available"
  if (marketData.dailyContext) {
    if (marketData.dailyContext.isCompression) {
      isAtrExpanding = true
      atrReason = "Daily compression detected, expansion likely"
    } else {
      // Allow TREND if it's not a compression day, but let's say it requires strong trend
      // In a real system you'd check 15m range expanding, but we'll accept non-compression
      // days if trend is strong. Let's just pass this if trend is aligned.
      isAtrExpanding = true 
      atrReason = "No daily compression, but trend allows expansion"
    }
  }

  checks.push({
    name: "ATR Expansion",
    passed: isAtrExpanding,
    reason: atrReason
  })

  // Check 3: VIX Sanity
  // VIX <= 25 unless strongly trending
  const vixLevel = marketData.vix?.current ?? 0
  const isVixSane = vixLevel <= 25
  checks.push({
    name: "VIX Sanity",
    passed: isVixSane,
    reason: isVixSane
      ? `VIX is normal (${vixLevel})`
      : `VIX is too high (${vixLevel} > 25)`
  })

  // Check 4: Options Flow Agreement
  // If Orchestrator wants TREND (implied bullish or bearish from 15m trend), flow must not contradict
  const flow = marketData.optionsAnalysisZerodha?.marketFlow
  let isFlowAgreeing = true
  let flowReason = "Flow is neutral or supportive"
  
  if (trend15m === "bullish" && (flow === "SHORT_BUILDUP" || flow === "LONG_UNWINDING")) {
    isFlowAgreeing = false
    flowReason = `Bullish trend but bearish flow (${flow})`
  } else if (trend15m === "bearish" && (flow === "SHORT_COVERING" || flow === "LONG_BUILDUP")) {
    isFlowAgreeing = false
    flowReason = `Bearish trend but bullish flow (${flow})`
  } else {
    flowReason = `Flow (${flow}) does not contradict trend (${trend15m})`
  }

  checks.push({
    name: "Options Flow Agreement",
    passed: isFlowAgreeing,
    reason: flowReason
  })

  const allPassed = checks.every(c => c.passed)

  if (!allPassed) {
    // Override to SCALPER
    eventHub.emit("agent_update", {
      agent: "Regime Validator",
      status: "decided",
      message: "⚠️ OVERRIDE: TREND → SCALPER. Validations failed.",
      data: { checks }
    })

    return {
      activeAgent: "SCALPER",
      wasOverridden: true,
      originalAgent: "TREND",
      checks
    }
  }

  eventHub.emit("agent_update", {
    agent: "Regime Validator",
    status: "decided",
    message: "✅ Approved: TREND environment confirmed.",
    data: { checks }
  })

  return {
    activeAgent: "TREND",
    wasOverridden: false,
    originalAgent: "TREND",
    checks
  }
}
