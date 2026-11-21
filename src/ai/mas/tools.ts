import type { AISuccessResponse, LLMToolDefinition, TradingAgentType } from '../types.js'
import type { CapabilityGrant, TradingBlackboard, TradingDomainPolicyConfig } from './types.js'
import { DEFAULT_TRADING_DOMAIN_POLICY } from './types.js'
import { createTaggedValue } from './contracts.js'
import { MarketRegistry } from '../../markets/registry.js'

// ============================================================================
// B12 (Ch. 14 RG1 & AM3): ToolCallMediator enforcing 12-field CapabilityGrant
// ============================================================================
export class ToolCallMediator {
  private callsUsed = 0

  constructor(private readonly grant: CapabilityGrant) {}

  public wrapTools(tools: readonly LLMToolDefinition[], currentClaimVersion: number): LLMToolDefinition[] {
    return tools
      .filter((t) => this.grant.allowedTools.includes(t.name))
      .map((tool) => ({
        ...tool,
        execute: async (args: Record<string, unknown>) => {
          if (Date.now() > this.grant.expiresAtMs) {
            return {
              error: 'CAPABILITY_GRANT_EXPIRED',
              attempts: this.callsUsed + 1,
              suggestion: 'Finalize JSON decision immediately without further tool calls.',
            }
          }
          if (currentClaimVersion !== this.grant.claimVersionBound) {
            return {
              error: 'CLAIM_VERSION_SUPERSEDED',
              attempts: this.callsUsed + 1,
              suggestion: 'Market tick superseded; abort tool execution.',
            }
          }
          if (this.callsUsed >= this.grant.maxToolCalls) {
            return {
              error: `MAX_TOOL_CALLS_EXCEEDED (${this.grant.maxToolCalls})`,
              attempts: this.callsUsed,
              suggestion: 'Synthesize final JSON response using already retrieved context.',
            }
          }
          this.callsUsed += 1
          const rawResult = await Promise.resolve(tool.execute(args))
          return createTaggedValue(rawResult, 'VERIFIED_TOOL', tool.name)
        },
      }))
  }
}

// ============================================================================
// B3 (Ch. 4 pp. 79-81): 6 Deterministic MAS Tools with Structured Error Hints
// ============================================================================
export class MASToolRegistry {
  public static buildStructureTools(blackboard: TradingBlackboard): LLMToolDefinition[] {
    return [
      {
        name: 'inspectWaveAndSwings',
        description:
          'Returns the recent 15m swing points (HIGH/LOW), Elliott Wave Fibonacci retracement zones, and Wave 5 target.',
        parameters: {
          type: 'object',
          properties: {
            limit: {
              type: 'number',
              description: 'Number of recent swing points to inspect (1 to 10).',
            },
          },
          required: ['limit'],
        },
        execute: (args) => {
          const limit = Number(args.limit ?? 6)
          if (Number.isNaN(limit) || limit < 1 || limit > 20) {
            return {
              error: `Invalid limit parameter: ${String(args.limit)}`,
              attempts: 1,
              suggestion: 'Pass a numeric limit between 1 and 10.',
            }
          }
          return {
            wavePhase: blackboard.structureSlice.tf15m.wavePhase,
            wave5Target: blackboard.structureSlice.tf15m.wave5Target,
            fibZones: blackboard.structureSlice.tf15m.fibZones,
            recentSwings: blackboard.rawSwingPoints15m.slice(-Math.min(10, Math.round(limit))),
          }
        },
      },
      {
        name: 'getReversalQualityBreakdown',
        description:
          'Returns the Bullish and Bearish Reversal Quality Scores (0-5) and whether Playbook B (INSTITUTIONAL_TRAP) is permitted.',
        parameters: {
          type: 'object',
          properties: {
            direction: {
              type: 'string',
              description: 'BULLISH or BEARISH',
            },
          },
          required: ['direction'],
        },
        execute: (args) => {
          const dir = String(args.direction || 'BULLISH').toUpperCase()
          if (dir !== 'BULLISH' && dir !== 'BEARISH') {
            return {
              error: `Invalid direction "${dir}"`,
              attempts: 1,
              suggestion: 'Pass direction as "BULLISH" or "BEARISH".',
            }
          }
          const score =
            dir === 'BULLISH'
              ? blackboard.structureSlice.reversalScore.bullish
              : blackboard.structureSlice.reversalScore.bearish
          return {
            direction: dir,
            score,
            maxScore: 5,
            playbookBPermitted: score >= blackboard.policy.minTrapReversalScore,
            minimumRequired: blackboard.policy.minTrapReversalScore,
          }
        },
      },
      {
        name: 'inspectSessionHorizon',
        description:
          'Evaluates remaining intraday session time before EOD square-off to prevent late runway traps across markets.',
        parameters: {
          type: 'object',
          properties: {},
        },
        execute: () => {
          const activeMarket = MarketRegistry.getActiveMarket()
          if (activeMarket.is24x7) {
            return {
              marketId: activeMarket.id,
              is24x7: true,
              currentIstTime: '24x7',
              timeToSquareOffMins: Number.POSITIVE_INFINITY,
              isClosingRunwayRisk: false,
              recommendation: 'ALLOW_ALL' as const,
              rationale: `Continuous 24/7 market (${activeMarket.name}). No intraday runway constraints or mandatory EOD liquidation.`,
            }
          }

          const istTimeStr = blackboard.structureSlice.istTime || ''
          const now = new Date()
          let currentMinutesFromMidnight = 0

          const match = istTimeStr.match(/(\d{1,2}):(\d{2})/)
          if (match) {
            currentMinutesFromMidnight = parseInt(match[1]!, 10) * 60 + parseInt(match[2]!, 10)
          } else {
            const formatter = new Intl.DateTimeFormat('en-US', {
              timeZone: activeMarket.timezone,
              hour12: false,
              hour: 'numeric',
              minute: 'numeric',
            })
            const parts = formatter.formatToParts(now)
            const h = parseInt(parts.find((p) => p.type === 'hour')?.value || '0', 10)
            const m = parseInt(parts.find((p) => p.type === 'minute')?.value || '0', 10)
            currentMinutesFromMidnight = h * 60 + m
          }

          const closeTimeParts = activeMarket.config.closeTime.split(':').map((v) => parseInt(v, 10))
          const marketCloseMinutes = (closeTimeParts[0] ?? 0) * 60 + (closeTimeParts[1] ?? 0)
          const squareOffBuffer = activeMarket.config.squareOffMinutesBeforeClose ?? 15
          const squareOffMinutes = marketCloseMinutes - squareOffBuffer

          const timeToSquareOffMins = Math.max(0, squareOffMinutes - currentMinutesFromMidnight)
          const isClosingRunwayRisk = timeToSquareOffMins < 45

          let recommendation: 'ALLOW_ALL' | 'SCALP_ONLY_TIGHT_SL' | 'REJECT_NEW_ENTRIES' = 'ALLOW_ALL'
          let rationale = `Sufficient runway (${timeToSquareOffMins}m remaining until square-off for ${activeMarket.name}).`

          if (timeToSquareOffMins <= 15) {
            recommendation = 'REJECT_NEW_ENTRIES'
            rationale = `CRITICAL: Only ${timeToSquareOffMins}m left before mandatory EOD liquidation. New entries prohibited.`
          } else if (timeToSquareOffMins < 45) {
            recommendation = 'SCALP_ONLY_TIGHT_SL'
            rationale = `Tight runway (${timeToSquareOffMins}m left). Trend continuation prohibited; rapid scalps with tight stops only.`
          }

          return {
            marketId: activeMarket.id,
            currentIstTime: istTimeStr || `${Math.floor(currentMinutesFromMidnight / 60)}:${currentMinutesFromMidnight % 60}`,
            timeToSquareOffMins,
            isClosingRunwayRisk,
            recommendation,
            rationale,
          }
        },
      },
      {
        name: 'inspectSectorBreadthAndBeta',
        description:
          'Evaluates sector alignment and relative strength vs NIFTY benchmark to prevent counter-beta trade traps.',
        parameters: {
          type: 'object',
          properties: {
            symbol: { type: 'string', description: 'Stock or Index symbol' },
          },
        },
        execute: (args) => {
          const sym = String(args.symbol || blackboard.symbol).toUpperCase()
          const tf15m = blackboard.structureSlice.tf15m
          const macro = blackboard.macroSlice

          // Relative momentum proxy using VWAP position and RSI
          const isStockAboveVwap = tf15m.price > tf15m.vwap
          const isBenchmarkBullish = (macro.gtiScore?.composite ?? 0) >= 0 || macro.vix.current < 16

          let sectorAlignment: 'ALIGNED' | 'DIVERGENT' | 'NEUTRAL' = 'NEUTRAL'
          let recommendation: 'ALIGNED' | 'CAUTION_DIVERGENT' | 'VETO_COUNTER_TREND' = 'ALIGNED'
          let note = 'Normal market beta.'

          if (isStockAboveVwap && !isBenchmarkBullish) {
            sectorAlignment = 'DIVERGENT'
            recommendation = 'CAUTION_DIVERGENT'
            note = `${sym} shows positive relative strength despite weak benchmark. Sizing reduction recommended.`
          } else if (!isStockAboveVwap && isBenchmarkBullish) {
            sectorAlignment = 'DIVERGENT'
            recommendation = 'VETO_COUNTER_TREND'
            note = `${sym} is lagging below VWAP while broad market is risk-on. Shorting into market strength has low expectancy.`
          }

          return {
            symbol: sym,
            sectorAlignment,
            recommendation,
            benchmarkVix: macro.vix.current,
            benchmarkGti: macro.gtiScore?.composite ?? 0,
            priceVsVwap: isStockAboveVwap ? 'ABOVE' : 'BELOW',
            rsi14: tf15m.rsi14,
            note,
          }
        },
      },
    ]
  }

  public static buildOptionsTools(blackboard: TradingBlackboard): LLMToolDefinition[] {
    return [
      {
        name: 'inspectOptionStrikeChain',
        description: 'Inspects CE and PE option chain rows around a target strike price.',
        parameters: {
          type: 'object',
          properties: {
            centerStrike: {
              type: 'number',
              description: 'Center strike price (e.g. ATM strike).',
            },
            radiusStrikes: {
              type: 'number',
              description: 'Number of strikes above and below centerStrike (1 to 4).',
            },
          },
          required: ['centerStrike'],
        },
        execute: (args) => {
          const center = Number(args.centerStrike || blackboard.optionsSlice.atmStrike)
          if (center <= 0) {
            return {
              error: 'centerStrike must be a positive strike price',
              attempts: 1,
              suggestion: `Use atmStrike (${blackboard.optionsSlice.atmStrike}).`,
            }
          }
          const radius = Math.min(4, Math.max(1, Number(args.radiusStrikes ?? 2))) * 100
          const matching = blackboard.rawOptionRows.filter((r) => Math.abs(r.strike - center) <= radius)
          return {
            centerStrike: center,
            rowsCount: matching.length,
            rows: matching,
          }
        },
      },
      {
        name: 'simulateStrikePayoff',
        description:
          'Simulates option premium PnL using a 2nd-Order Taylor Expansion (Delta + 0.5*Gamma*dS^2 + Theta*dt) for a given index move.',
        parameters: {
          type: 'object',
          properties: {
            strike: { type: 'number', description: 'Option strike price' },
            optionType: { type: 'string', description: 'CE or PE' },
            expectedIndexMovePoints: {
              type: 'number',
              description: 'Signed index move in points (e.g. +40 for rally, -40 for drop)',
            },
            holdingMinutes: { type: 'number', description: 'Expected holding period in minutes (e.g. 30)' },
          },
          required: ['strike', 'optionType', 'expectedIndexMovePoints', 'holdingMinutes'],
        },
        execute: (args) => {
          const strike = Number(args.strike)
          const optionType = String(args.optionType || 'CE').toUpperCase()
          const dS = Number(args.expectedIndexMovePoints || 0)
          const holdMins = Math.max(1, Number(args.holdingMinutes || 30))

          const row = blackboard.rawOptionRows.find((r) => r.strike === strike && r.type === optionType)
          if (!row) {
            return {
              error: `Option row not found for ${strike} ${optionType}`,
              attempts: 1,
              suggestion: `Choose a strike from focusedRows around ATM ${blackboard.optionsSlice.atmStrike}.`,
            }
          }

          const signedDelta = optionType === 'CE' ? Math.abs(row.delta) : -Math.abs(row.delta)
          const deltaContribution = signedDelta * dS
          const gammaContribution = 0.5 * row.gamma * dS * dS
          const tradingMinutesPerDay = 375
          const thetaContribution = -Math.abs(row.theta) * (holdMins / tradingMinutesPerDay)
          const projectedPremiumChange = deltaContribution + gammaContribution + thetaContribution
          const projectedLtp = Math.max(0.05, Number((row.ltp + projectedPremiumChange).toFixed(2)))

          return {
            symbol: row.symbol,
            currentLtp: row.ltp,
            projectedLtp,
            projectedPremiumChange: Number(projectedPremiumChange.toFixed(2)),
            breakdown: {
              deltaContribution: Number(deltaContribution.toFixed(2)),
              gammaContribution: Number(gammaContribution.toFixed(2)),
              thetaContribution: Number(thetaContribution.toFixed(2)),
            },
          }
        },
      },
      {
        name: 'inspectOptionVelocity',
        description:
          'Evaluates if an option contract has spiked excessively in the last 5 minutes to prevent top-tick market chasing.',
        parameters: {
          type: 'object',
          properties: {
            strike: { type: 'number', description: 'Option strike' },
            optionType: { type: 'string', description: 'CE or PE' },
          },
          required: ['strike', 'optionType'],
        },
        execute: (args) => {
          const strike = Number(args.strike)
          const optionType = String(args.optionType || 'CE').toUpperCase()
          const row = blackboard.rawOptionRows.find((r) => r.strike === strike && r.type === optionType)
          const liveTicks = blackboard.structureSlice.liveTrigger?.downsampledTicks || []

          let tickSurgePct = 0
          if (liveTicks.length >= 2) {
            const first = liveTicks[0]!
            const last = liveTicks[liveTicks.length - 1]!
            tickSurgePct = Number((((last - first) / first) * 100).toFixed(2))
          }

          // Spike check: if option LTP is high relative to ATM or index surged abruptly (>0.15% in 1m)
          const isHyperExtended = Math.abs(tickSurgePct) > 0.15 || (row && row.iv > 35)
          const currentLtp = row ? row.ltp : 50
          const suggestedLimitPrice = Number((currentLtp * 0.90).toFixed(2)) // 10% pullback entry queue

          return {
            strike,
            optionType,
            currentLtp,
            recentIndexTickSurgePct: tickSurgePct,
            isHyperExtended,
            executionRecommendation: isHyperExtended ? 'QUEUE_PULLBACK_LIMIT' : 'ENTER_MARKET',
            suggestedLimitPrice: isHyperExtended ? suggestedLimitPrice : currentLtp,
            rationale: isHyperExtended
              ? `Spike surge detected (${tickSurgePct}% index impulse). Do not chase market buy; queue pending limit at ${suggestedLimitPrice}.`
              : 'Normal order book velocity. Market execution permitted.',
          }
        },
      },
      {
        name: 'inspectDynamicGreeksSurface',
        description:
          'Evaluates strike Delta, Theta burn, and low-denominator sensitivity to prevent selecting sluggish deep OTM strikes.',
        parameters: {
          type: 'object',
          properties: {
            strike: { type: 'number', description: 'Candidate strike price' },
            optionType: { type: 'string', description: 'CE or PE' },
          },
          required: ['strike', 'optionType'],
        },
        execute: (args) => {
          const strike = Number(args.strike)
          const optionType = String(args.optionType || 'CE').toUpperCase()
          const row = blackboard.rawOptionRows.find((r) => r.strike === strike && r.type === optionType)
          const dte = blackboard.optionsSlice.daysToExpiry

          if (!row) {
            return {
              error: `Strike ${strike} ${optionType} not found in active chain.`,
              attempts: 1,
              suggestion: `Select strike near ATM ${blackboard.optionsSlice.atmStrike}.`,
            }
          }

          const deltaAbs = Math.abs(row.delta)
          const isDeltaLowRisk = deltaAbs < 0.35 && dte >= 1.0

          // Find ATM or Near-ITM alternative with safe Delta (0.45 - 0.58)
          const safeAlternative = blackboard.rawOptionRows.find(
            (r) => r.type === optionType && Math.abs(r.delta) >= 0.45 && Math.abs(r.delta) <= 0.60
          )

          return {
            strike: row.strike,
            optionType: row.type,
            ltp: row.ltp,
            delta: row.delta,
            gamma: row.gamma,
            theta: row.theta,
            daysToExpiry: dte,
            isDeltaLowRisk,
            recommendedStrike: isDeltaLowRisk && safeAlternative ? safeAlternative.strike : row.strike,
            rationale: isDeltaLowRisk
              ? `Delta (${row.delta.toFixed(2)}) is sluggish (<0.35 on ${dte.toFixed(1)} DTE). Risk of premature shakeout and missed ratchets. Switch to ATM ${safeAlternative?.strike ?? blackboard.optionsSlice.atmStrike}.`
              : `Delta (${row.delta.toFixed(2)}) is optimal for responsive profit ratchet execution.`,
          }
        },
      },
    ]
  }

  public static buildMacroTools(blackboard: TradingBlackboard): LLMToolDefinition[] {
    return [
      {
        name: 'inspectGtiComponents',
        description:
          'Returns the 5 underlying institutional GTI components (volumeAnomaly, cvd, vwapDeviation, oiSignal, smartMoneyFlow).',
        parameters: {
          type: 'object',
          properties: {},
        },
        execute: () => ({
          gtiScore: blackboard.macroSlice.gtiScore ?? {
            composite: 0,
            classification: 'NEUTRAL',
            confidence: 0,
            components: {},
          },
          vix: blackboard.macroSlice.vix,
        }),
      },
    ]
  }

  public static buildCriticAndJudgeTools(blackboard: TradingBlackboard): LLMToolDefinition[] {
    return [
      {
        name: 'queryPastRegimeFailures',
        description: 'Returns untrusted episodic memory context and pre-flight gate warnings for the active regime.',
        parameters: {
          type: 'object',
          properties: {},
        },
        execute: () => ({
          memoryData: blackboard.memoryContextTagged.value,
          trustLabel: blackboard.memoryContextTagged.trustLabel,
          preFlightBlockReasons: blackboard.preFlightGates.blockReasons,
          preFlightCautionNotes: blackboard.preFlightGates.cautionNotes,
        }),
      },
      {
        name: 'verifyTradeMath',
        description:
          'Deterministically verifies candidate entry, stopLoss, targets, and optionAction against regime risk bounds.',
        parameters: {
          type: 'object',
          properties: {
            optionAction: { type: 'string', description: 'BUY_CE or BUY_PE' },
            entry: { type: 'number', description: 'Index entry price' },
            stopLoss: { type: 'number', description: 'Index stopLoss level' },
            firstTarget: { type: 'number', description: 'First index target level' },
          },
          required: ['optionAction', 'entry', 'stopLoss', 'firstTarget'],
        },
        execute: (args) => {
          const validator = new TradePlanMathValidator(blackboard.policy)
          const candidate: AISuccessResponse = {
            decision: 'BUY',
            optionAction: (String(args.optionAction) === 'BUY_PE' ? 'BUY_PE' : 'BUY_CE') as 'BUY_CE' | 'BUY_PE',
            setup: 'TRUE_BREAKOUT',
            macroTrend: 'SIDEWAYS',
            instrument: 'OPTIONS',
            strike: blackboard.optionsSlice.atmStrike,
            entry: Number(args.entry),
            stopLoss: Number(args.stopLoss),
            targets: [Number(args.firstTarget)],
            riskRewardRatio: 1.5,
            confidence: 80,
            reason: 'Verification check',
          }
          return validator.validateCandidatePlan(
            candidate,
            blackboard.structureSlice.tf15m.price,
            blackboard.activeAgent,
            blackboard.structureSlice.mode,
            blackboard.preFlightGates
          )
        },
      },
      ...MASToolRegistry.buildStructureTools(blackboard).filter(
        (t) => t.name === 'inspectSessionHorizon' || t.name === 'inspectSectorBreadthAndBeta'
      ),
      ...MASToolRegistry.buildOptionsTools(blackboard).filter(
        (t) => t.name === 'inspectOptionVelocity' || t.name === 'inspectDynamicGreeksSurface'
      ),
    ]
  }
}

// ============================================================================
// B10 (Ch. 12 p. 530): Ordered Runtime Policy Gate & TradePlanMathValidator
// Gate 1: Hard Safety / Risk / Pre-Flight Veto (Un-repairable)
// Gate 2: Structural Index Stop, Target Monotonicity & R:R Math Bounds (Repairable)
// ============================================================================
export interface PolicyGateValidationResult {
  readonly valid: boolean
  readonly isHardRiskVeto: boolean
  readonly errors: readonly string[]
  readonly computedRiskRewardRatio: number
}

export class TradePlanMathValidator {
  constructor(private readonly policy: TradingDomainPolicyConfig = DEFAULT_TRADING_DOMAIN_POLICY) {}

  public validateCandidatePlan(
    decision: AISuccessResponse,
    spotPrice: number,
    agentType: TradingAgentType,
    mode: string,
    preFlightGates: TradingBlackboard['preFlightGates'],
    criticVerdict?: 'APPROVE' | 'CHALLENGE_REDUCE_SIZE' | 'HARD_VETO'
  ): PolicyGateValidationResult {
    if (decision.decision === 'NO_TRADE' || decision.optionAction === 'NONE') {
      return { valid: true, isHardRiskVeto: false, errors: [], computedRiskRewardRatio: 0 }
    }

    // Gate 1 (Ordered Policy Gate Step 1): Hard Risk / Pre-Flight Veto checked BEFORE math/schema repair
    const hardVetoErrors = this.checkHardSafetyVeto(decision, agentType, preFlightGates, criticVerdict)
    if (hardVetoErrors.length > 0) {
      return {
        valid: false,
        isHardRiskVeto: true,
        errors: hardVetoErrors,
        computedRiskRewardRatio: 0,
      }
    }

    // Gate 2 (Ordered Policy Gate Step 2): Repairable Math, Scale & R:R checks
    const bounds =
      mode === 'swing'
        ? this.policy.swingBounds
        : agentType === 'TREND'
          ? this.policy.trendBounds
          : this.policy.scalperBounds

    const entry = decision.entry || spotPrice
    const stopLoss = decision.stopLoss
    const isBearish = decision.optionAction === 'BUY_PE'
    const firstTarget = decision.targets?.[0]

    const mathErrors: (string | null)[] = [
      entry <= 0 ? 'Entry price must be positive index level' : null,
      !stopLoss || stopLoss < spotPrice * 0.85 || stopLoss > spotPrice * 1.15
        ? `stopLoss (${stopLoss}) is not on the underlying index scale near spot (${spotPrice})`
        : null,
      isBearish && stopLoss <= entry
        ? `BUY_PE requires index stopLoss (${stopLoss}) strictly ABOVE entry (${entry})`
        : null,
      !isBearish && stopLoss >= entry
        ? `BUY_CE requires index stopLoss (${stopLoss}) strictly BELOW entry (${entry})`
        : null,
    ]

    const slDistPct = entry > 0 ? Math.abs(stopLoss - entry) / entry : 0
    const distErrors: (string | null)[] = [
      slDistPct < bounds.minSlPct
        ? `stopLoss distance (${(slDistPct * 100).toFixed(3)}%) is tighter than minimum (${(bounds.minSlPct * 100).toFixed(2)}%)`
        : null,
      slDistPct > bounds.maxSlPct
        ? `stopLoss distance (${(slDistPct * 100).toFixed(2)}%) exceeds maximum (${(bounds.maxSlPct * 100).toFixed(2)}%) for ${agentType}`
        : null,
      !firstTarget
        ? 'At least one index target is required in targets[]'
        : isBearish && firstTarget >= entry
          ? `BUY_PE requires first target (${firstTarget}) strictly BELOW entry (${entry})`
          : !isBearish && firstTarget <= entry
            ? `BUY_CE requires first target (${firstTarget}) strictly ABOVE entry (${entry})`
            : Math.abs(firstTarget - entry) / entry > bounds.maxTargetPct
              ? `First target (${firstTarget}) exceeds max target distance (${(bounds.maxTargetPct * 100).toFixed(1)}%)`
              : null,
    ]

    const riskPts = Math.abs(entry - stopLoss)
    const rewardPts = firstTarget ? Math.abs(firstTarget - entry) : 0
    const computedRr = riskPts > 0 ? Number((rewardPts / riskPts).toFixed(2)) : 0
    const rrError =
      computedRr < bounds.minRiskRewardRatio
        ? `Computed R:R (${computedRr}) is below minimum (${bounds.minRiskRewardRatio}) for ${agentType}`
        : null

    const allErrors = [...mathErrors, ...distErrors, rrError].filter((e): e is string => e !== null)

    return {
      valid: allErrors.length === 0,
      isHardRiskVeto: false,
      errors: allErrors,
      computedRiskRewardRatio: computedRr,
    }
  }

  private checkHardSafetyVeto(
    decision: AISuccessResponse,
    agentType: TradingAgentType,
    preFlightGates: TradingBlackboard['preFlightGates'],
    criticVerdict?: 'APPROVE' | 'CHALLENGE_REDUCE_SIZE' | 'HARD_VETO'
  ): string[] {
    if (criticVerdict === 'HARD_VETO') {
      return ['HARD_VETO: AdversarialCriticAgent issued a terminal veto on this setup']
    }
    if (preFlightGates.isBlocked) {
      return [`PREFLIGHT_BLOCKED: ${preFlightGates.blockReasons.join('; ')}`]
    }

    const allowedForSetup =
      decision.setup === 'INSTITUTIONAL_TRAP'
        ? preFlightGates.trapAllowedActions
        : agentType === 'TREND' || decision.setup === 'TRUE_BREAKOUT'
          ? preFlightGates.trendAllowedActions
          : preFlightGates.scalperAllowedActions

    if (!allowedForSetup.includes(decision.optionAction)) {
      return [
        `ACTION_FORBIDDEN_BY_GATE: ${decision.optionAction} is not permitted for ${agentType} (${decision.setup}). Allowed: [${allowedForSetup.join(', ')}]`,
      ]
    }
    return []
  }
}
