import type {
  AIMarketActivitySetup,
  AIOptionAction,
  AISentimentResponse,
  AISuccessResponse,
  LLMToolCallRecord,
  TradingAgentType,
} from '../types.js'
import type { GTIScore, OpeningRange, SwingPoint, WaveContext } from '../../types/analysis.js'
import type { VolumeProfile } from '../../types/analysis.js'

// ============================================================================
// B1 (Ch. 2 pp. 21-23 & Ch. 4 p. 88): AutonomyContract & TaskContract
// ============================================================================
export interface AutonomyContract {
  readonly role: string
  readonly goal: string
  readonly observableState: readonly string[]
  readonly decisionScope: readonly string[]
  readonly feedbackLoop: string
  readonly healthyEscalationBand: readonly [number, number]
}

export interface TaskContract {
  readonly contractId: string
  readonly objective: string
  readonly constraints: readonly string[]
  readonly successCriteria: readonly string[]
  readonly escalationTrigger: string
}

// ============================================================================
// B4 (Ch. 5 pp. 114-134): 7-Element HandoffPayload, 5 Lifecycle States, AgentMessage
// ============================================================================
export type TaskLifecycleState = 'succeeded' | 'failed' | 'rejected' | 'expired' | 'canceled'

export interface HandoffPayload<T> {
  readonly claim: T
  readonly provenance: {
    readonly sourceAgent: string
    readonly citedFields: readonly string[]
    readonly toolCallsUsed: readonly string[]
  }
  readonly uncertainty: readonly string[]
  readonly action: 'PROPOSE' | 'CRITIQUE' | 'SYNTHESIZE' | 'VETO' | 'ABSTAIN'
  readonly permissions: readonly string[]
  readonly resultSchema: string
  readonly acceptance: {
    readonly verifiedCitations: boolean
    readonly verifiedReasoningActionMatch: boolean
    readonly withinDeadline: boolean
  }
}

export interface AgentMessage<T> {
  readonly messageId: string
  readonly correlationId: string
  readonly sender: string
  readonly recipient: string
  readonly claimVersion: number
  readonly timestampMs: number
  readonly deadlineRemainingMs: number
  readonly lifecycleState: TaskLifecycleState
  readonly handoff: HandoffPayload<T>
  readonly hmacSignature: string
}

// ============================================================================
// B8 (Ch. 9 & 10 pp. 390-391): Regulated Financial Workflow Policy Config
// ============================================================================
export interface RegimeRiskBounds {
  readonly minSlPct: number
  readonly maxSlPct: number
  readonly maxTargetPct: number
  readonly minRiskRewardRatio: number
}

export interface TradingDomainPolicyConfig {
  readonly policyVersion: string
  readonly maxVixAllowed: number
  readonly minExecutionConfidence: number
  readonly fullSizeConfidence: number
  readonly minTrapReversalScore: number
  readonly maxScalperVwapZScore: number
  readonly maxTrendBlowoffVwapZScore: number
  readonly gtiSevereOppositionThreshold: number
  readonly gtiMildOppositionThreshold: number
  readonly maxIvrForAtmBuy: number
  readonly minItmDeltaForHighIvr: number
  readonly minItmDeltaForZeroDteChop: number
  readonly scalperBounds: RegimeRiskBounds
  readonly trendBounds: RegimeRiskBounds
  readonly swingBounds: RegimeRiskBounds
}

export const DEFAULT_TRADING_DOMAIN_POLICY: TradingDomainPolicyConfig = Object.freeze({
  policyVersion: '2026.10.v2-regulated-options',
  maxVixAllowed: 25,
  minExecutionConfidence: 60,
  fullSizeConfidence: 75,
  minTrapReversalScore: 3,
  maxScalperVwapZScore: 2.0,
  maxTrendBlowoffVwapZScore: 3.5,
  gtiSevereOppositionThreshold: 0.6,
  gtiMildOppositionThreshold: 0.3,
  maxIvrForAtmBuy: 70,
  minItmDeltaForHighIvr: 0.55,
  minItmDeltaForZeroDteChop: 0.6,
  scalperBounds: Object.freeze({
    minSlPct: 0.0004,
    maxSlPct: 0.015,
    maxTargetPct: 0.03,
    minRiskRewardRatio: 1.2,
  }),
  trendBounds: Object.freeze({
    minSlPct: 0.0008,
    maxSlPct: 0.02,
    maxTargetPct: 0.05,
    minRiskRewardRatio: 1.5,
  }),
  swingBounds: Object.freeze({
    minSlPct: 0.001,
    maxSlPct: 0.025,
    maxTargetPct: 0.05,
    minRiskRewardRatio: 1.5,
  }),
})

// ============================================================================
// B12 (Ch. 14 & 15): 12-Field CapabilityGrant (AM1) & TaggedValue (AM3)
// ============================================================================
export type TrustLabel = 'TRUSTED_SYSTEM' | 'VERIFIED_TOOL' | 'UNTRUSTED_MEMORY' | 'UNTRUSTED_EXTERNAL'

export interface TaggedValue<T> {
  readonly value: T
  readonly trustLabel: TrustLabel
  readonly source: string
  readonly sanitizedAtMs: number
}

export interface CapabilityGrant {
  readonly grantId: string
  readonly granteeAgent: string
  readonly issuer: string
  readonly allowedTools: readonly string[]
  readonly readableSlices: readonly string[]
  readonly writableFields: readonly string[]
  readonly maxToolCalls: number
  readonly maxTokens: number
  readonly issuedAtMs: number
  readonly expiresAtMs: number
  readonly claimVersionBound: number
  readonly delegationDepth: number
}

// ============================================================================
// B10 (Ch. 12 pp. 478-505): OpenTelemetry gen_ai.* & mas.* Span Attributes
// ============================================================================
export interface OTelMasSpanAttributes {
  readonly 'gen_ai.system': string
  readonly 'gen_ai.request.model': string
  readonly 'gen_ai.agent.name': string
  readonly 'gen_ai.usage.input_tokens': number
  readonly 'gen_ai.usage.output_tokens': number
  readonly 'gen_ai.usage.cached_tokens': number
  readonly 'mas.workflow.id': string
  readonly 'mas.step.index': number
  readonly 'mas.pattern': 'PARALLEL_FANOUT' | 'ADVERSARIAL_DEBATE' | 'HIERARCHICAL_JUDGE' | 'REFLEXION_REPAIR'
  readonly 'mas.handoff.source': string
  readonly 'mas.handoff.target': string
  readonly 'mas.termination_reason': TaskLifecycleState
}

export interface AgentTraceSpan {
  readonly nodeId: string
  readonly agentName: string
  readonly startedAtMs: number
  readonly durationMs: number
  readonly status: 'ok' | 'degraded' | 'vetoed' | 'repaired' | 'canceled'
  readonly summary: string
  readonly toolCalls: readonly LLMToolCallRecord[]
  readonly otelAttributes: OTelMasSpanAttributes
}

// ============================================================================
// B9 (Ch. 11 pp. 446-452): CoordinationMetrics & Unit Economics
// ============================================================================
export interface CoordinationMetrics {
  readonly redundancyRatio: number
  readonly workloadConcentration: number
  readonly handoffRetention: number
  readonly convergenceRounds: number
  readonly costPerSuccessfulOutcomeTokens: number
  readonly passPowerK: number
}

// ============================================================================
// F1: Regime & Setup-Scoped Pre-Flight Gate Summary
// ============================================================================
export interface PreFlightGateSummary {
  readonly isBlocked: boolean
  readonly blockReasons: readonly string[]
  readonly allowedActions: readonly AIOptionAction[]
  readonly scalperAllowedActions: readonly AIOptionAction[]
  readonly trendAllowedActions: readonly AIOptionAction[]
  readonly trapAllowedActions: readonly AIOptionAction[]
  readonly reducedSizingMandatory: boolean
  readonly cautionNotes: readonly string[]
}

// ============================================================================
// Scoped Blackboard Slices (Principle 1: Bounded Context Isolation)
// ============================================================================
export interface TimeframeSummarySlice {
  readonly timeframe: string
  readonly price: number
  readonly vwap: number
  readonly vwapPosition: string
  readonly vwapZScore: number
  readonly rsi14: number
  readonly support: number
  readonly resistance: number
  readonly atr14: number
  readonly trend: string
  readonly ema: Record<string, number>
  readonly emaSlope: Record<string, number>
  readonly adx?: { readonly adx: number; readonly plusDI: number; readonly minusDI: number } | undefined
  readonly wavePhase?: WaveContext['currentPhase'] | undefined
  readonly wave5Target?: number | undefined
  readonly fibZones?: WaveContext['fibZones'] | undefined
  readonly openingRange?: OpeningRange | undefined
  readonly recentSwingsCount: number
}

export interface StructureBlackboardSlice {
  readonly symbol: string
  readonly mode: string
  readonly istTime: string
  readonly tf1h: TimeframeSummarySlice
  readonly tf30m: TimeframeSummarySlice
  readonly tf15m: TimeframeSummarySlice
  readonly tf3m: TimeframeSummarySlice
  readonly dailyContext: {
    readonly atr14: number
    readonly pdh: number
    readonly pdl: number
    readonly pdc: number
    readonly pdr: number
    readonly isCompression: boolean
    readonly openingRange?: OpeningRange | undefined
    readonly volumeProfile?: Omit<VolumeProfile, 'nodes'> | undefined
  } | null
  readonly reversalScore: { readonly bullish: number; readonly bearish: number }
  readonly liveTrigger?:
    | {
        readonly reason: string
        readonly lastPrice: number
        readonly downsampledTicks: readonly number[]
      }
    | undefined
  readonly omittedContextManifest: readonly string[]
}

export interface CompactOptionStrikeRow {
  readonly strike: number
  readonly type: 'CE' | 'PE'
  readonly symbol: string
  readonly ltp: number
  readonly oi: number
  readonly intervalOi: number
  readonly buildup: string
  readonly delta: number
  readonly gamma: number
  readonly theta: number
  readonly iv: number
}

export interface OptionsBlackboardSlice {
  readonly symbol: string
  readonly spotPrice: number
  readonly atmStrike: number
  readonly pcr: number
  readonly pcrAtm: number
  readonly sentiment: string
  readonly atmSentiment: string
  readonly marketFlow: string
  readonly supportWall: number
  readonly resistanceWall: number
  readonly ivRank: number
  readonly ivPercentile: number
  readonly daysToExpiry: number
  readonly recommendedBuyStrikeCE?:
    | {
        readonly strike: number
        readonly rationale: string
        readonly expectedGamma: number
        readonly gammaPremiumRatio: number
      }
    | undefined
  readonly recommendedBuyStrikePE?:
    | {
        readonly strike: number
        readonly rationale: string
        readonly expectedGamma: number
        readonly gammaPremiumRatio: number
      }
    | undefined
  readonly topShortCovering: readonly string[]
  readonly topLongBuildup: readonly string[]
  readonly focusedRows: readonly CompactOptionStrikeRow[]
  readonly omittedContextManifest: readonly string[]
}

export interface MacroBlackboardSlice {
  readonly symbol: string
  readonly istTime: string
  readonly vix: {
    readonly current: number
    readonly change: number
    readonly sentiment: string
  }
  readonly newsSentiment: AISentimentResponse
  readonly gtiScore?: GTIScore | undefined
  readonly omittedContextManifest: readonly string[]
}

export interface ConflictMatrix {
  readonly unanimousDirection: 'BULLISH' | 'BEARISH' | 'NONE'
  readonly hasDirectConflict: boolean
  readonly conflicts: readonly string[]
  readonly missingPerspectives: readonly string[]
  readonly weightedBullishScore: number
  readonly weightedBearishScore: number
  readonly highestConvictionAgent: string
}

// ============================================================================
// Specialist, Critic, Judge, Guardian, and PostMortem Report Schemas
// ============================================================================
export interface CitedIndicatorMap {
  readonly rsi14?: number | undefined
  readonly vwap?: number | undefined
  readonly support?: number | undefined
  readonly resistance?: number | undefined
  readonly pcr?: number | undefined
  readonly gtiComposite?: number | undefined
}

export interface StructureSpecialistReport {
  readonly activeRegime: TradingAgentType
  readonly bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL'
  readonly setup: AIMarketActivitySetup
  readonly wavePhase: string
  readonly confidence: number
  readonly structuralSupport: number
  readonly structuralResistance: number
  readonly candidateIndexStopLoss: number
  readonly candidateIndexTargets: readonly number[]
  readonly citedIndicators?: CitedIndicatorMap | undefined
  readonly reason: string
}

export interface OptionsSpecialistReport {
  readonly bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL'
  readonly confidence: number
  readonly dominantFlow: string
  readonly recommendedStrike: number | null
  readonly recommendedOptionAction: AIOptionAction
  readonly ivCrushRisk: 'LOW' | 'MODERATE' | 'HIGH'
  readonly thetaDecayRisk: 'LOW' | 'MODERATE' | 'HIGH'
  readonly keySignals: readonly string[]
  readonly citedIndicators?: CitedIndicatorMap | undefined
  readonly reason: string
}

export interface MacroSpecialistReport {
  readonly bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL'
  readonly confidence: number
  readonly vixRegime: 'CALM' | 'ELEVATED' | 'EXTREME'
  readonly institutionalFlowAligned: boolean
  readonly vetoRecommended: boolean
  readonly citedIndicators?: CitedIndicatorMap | undefined
  readonly reason: string
}

export interface AdversarialCriticReport {
  readonly verdict: 'APPROVE' | 'CHALLENGE_REDUCE_SIZE' | 'HARD_VETO'
  readonly preMortemFailureScenario: string
  readonly counterEvidence: readonly string[]
  readonly flowContradictionDetected: boolean
  readonly recommendedConfidenceAdjustment: number
  readonly mandatoryConditions: readonly string[]
  readonly reason: string
}

export interface PositionEvaluationHistoryEntry {
  readonly timestampMs: number
  readonly decision: 'HOLD' | 'EXIT' | 'UPDATE_SL'
  readonly newIndexStopLoss: number | null
  readonly reason: string
}

export interface PositionGuardianReport {
  readonly decision: 'HOLD' | 'EXIT' | 'UPDATE_SL'
  readonly newIndexStopLoss: number | null
  readonly riskRewardRatio: number | null
  readonly trailingStyle: 'LOOSE' | 'TIGHT' | 'EXTREME'
  readonly cleanSlateCounterfactual: 'WOULD_ENTER_FRESH' | 'HOLD_ONLY' | 'THESIS_BROKEN'
  readonly confidence: number
  readonly reason: string
}

export interface PostMortemDistilledLesson {
  readonly tradeId: string
  readonly symbol: string
  readonly regime: string
  readonly setup: string
  readonly outcome: 'WIN' | 'LOSS'
  readonly pnl: number
  readonly rootCauseCategory:
    | 'VALID_EXECUTION'
    | 'FALSE_BREAKOUT_TRAP'
    | 'OPTIONS_FLOW_MISMATCH'
    | 'PREMATURE_STOP_SHAKEOUT'
    | 'THETA_IV_CRUSH'
  readonly actionableRule: string
  readonly importanceScore: number
  readonly candidateLineageId: string
}

// ============================================================================
// Master TradingBlackboard (Shared State Across Graph Nodes)
// ============================================================================
export interface TradingBlackboard {
  readonly runId: string
  readonly claimVersion: number
  readonly symbol: string
  readonly userId: string
  readonly startedAtMs: number
  readonly deadlineMs: number
  readonly policy: TradingDomainPolicyConfig
  readonly taskContract: TaskContract
  readonly preFlightGates: PreFlightGateSummary
  readonly structureSlice: StructureBlackboardSlice
  readonly optionsSlice: OptionsBlackboardSlice
  readonly macroSlice: MacroBlackboardSlice
  readonly rawSwingPoints15m: readonly SwingPoint[]
  readonly rawOptionRows: readonly CompactOptionStrikeRow[]
  readonly memoryContextTagged: TaggedValue<string>
  lifecycleState: TaskLifecycleState
  activeAgent: TradingAgentType
  structureEnvelope?: AgentMessage<StructureSpecialistReport> | undefined
  optionsEnvelope?: AgentMessage<OptionsSpecialistReport> | undefined
  macroEnvelope?: AgentMessage<MacroSpecialistReport> | undefined
  conflictMatrix?: ConflictMatrix | undefined
  criticEnvelope?: AgentMessage<AdversarialCriticReport> | undefined
  finalDecision?: AISuccessResponse | undefined
  mathValidationErrors: string[]
  repairAttempts: number
  traceSpans: AgentTraceSpan[]
  coordinationMetrics?: CoordinationMetrics | undefined
}
