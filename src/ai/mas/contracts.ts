import crypto from 'node:crypto'
import type {
  AgentMessage,
  AgentTraceSpan,
  AutonomyContract,
  CapabilityGrant,
  CitedIndicatorMap,
  CoordinationMetrics,
  HandoffPayload,
  StructureBlackboardSlice,
  OptionsBlackboardSlice,
  MacroBlackboardSlice,
  TaggedValue,
  TaskLifecycleState,
  TrustLabel,
} from './types.js'

// ============================================================================
// B4 (Ch. 5 p. 124): Shared Monotonic RunDeadline
// ============================================================================
export class RunDeadline {
  private readonly startPerfMs: number

  constructor(private readonly totalBudgetMs: number = 25000) {
    this.startPerfMs = performance.now()
  }

  public elapsedMs(): number {
    return Math.max(0, Math.round(performance.now() - this.startPerfMs))
  }

  public remainingMs(): number {
    return Math.max(0, Math.round(this.totalBudgetMs - this.elapsedMs()))
  }

  public isExpired(): boolean {
    return this.remainingMs() <= 0
  }
}

// ============================================================================
// B3 (Ch. 4 p. 105): 4-Counter AgentBudget (steps, toolCalls, tokens, wallTime)
// ============================================================================
export class AgentBudget {
  private stepsUsed = 0
  private toolCallsUsed = 0
  private tokensUsed = 0
  private readonly startedAtPerfMs = performance.now()

  constructor(
    public readonly maxSteps: number = 4,
    public readonly maxToolCalls: number = 3,
    public readonly maxTokens: number = 12000,
    public readonly maxWallTimeMs: number = 12000
  ) {}

  public recordStep(toolCallsDelta: number, tokensDelta: number): void {
    this.stepsUsed += 1
    this.toolCallsUsed += Math.max(0, toolCallsDelta)
    this.tokensUsed += Math.max(0, tokensDelta)
  }

  public check(): string | null {
    const elapsed = performance.now() - this.startedAtPerfMs
    if (elapsed > this.maxWallTimeMs) {
      return `BUDGET_EXCEEDED: Wall time ${Math.round(elapsed)}ms > ${this.maxWallTimeMs}ms`
    }
    if (this.stepsUsed > this.maxSteps) {
      return `BUDGET_EXCEEDED: Steps ${this.stepsUsed} > ${this.maxSteps}`
    }
    if (this.toolCallsUsed > this.maxToolCalls) {
      return `BUDGET_EXCEEDED: Tool calls ${this.toolCallsUsed} > ${this.maxToolCalls}`
    }
    if (this.tokensUsed > this.maxTokens) {
      return `BUDGET_EXCEEDED: Tokens ${this.tokensUsed} > ${this.maxTokens}`
    }
    return null
  }

  public snapshot() {
    return {
      stepsUsed: this.stepsUsed,
      toolCallsUsed: this.toolCallsUsed,
      tokensUsed: this.tokensUsed,
      elapsedMs: Math.round(performance.now() - this.startedAtPerfMs),
    }
  }
}

// ============================================================================
// B12 (Ch. 15 p. 661): Atomic Budget Reservation Ledger (Reserve -> Settle)
// ============================================================================
export class AtomicBudgetLedger {
  private reservedTokens = 0
  private settledTokens = 0

  constructor(private readonly maxWorkflowTokens: number = 48000) {}

  public reserve(estimatedTokens: number): { allowed: boolean; reservationId: string } {
    const safeEstimate = Math.max(0, estimatedTokens)
    if (this.reservedTokens + this.settledTokens + safeEstimate > this.maxWorkflowTokens) {
      return { allowed: false, reservationId: '' }
    }
    this.reservedTokens += safeEstimate
    return { allowed: true, reservationId: `res_${Date.now()}_${safeEstimate}` }
  }

  public settle(reservedEstimate: number, actualTokens: number): void {
    this.reservedTokens = Math.max(0, this.reservedTokens - Math.max(0, reservedEstimate))
    this.settledTokens += Math.max(0, actualTokens)
  }

  public getTotalConsumedTokens(): number {
    return this.settledTokens
  }
}

// ============================================================================
// B4 & B12 (Ch. 5 & Ch. 14 AM5/RG2): MessageBusValidator (HMAC + Supersession)
// ============================================================================
export class MessageBusValidator {
  private readonly secretKey: string

  constructor(secretKey?: string) {
    this.secretKey = secretKey || process.env.MAS_HMAC_SECRET || 'mas-default-hmac-signing-key-2026'
  }

  public createSignedEnvelope<T>(params: {
    correlationId: string
    sender: string
    recipient: string
    claimVersion: number
    deadline: RunDeadline
    lifecycleState: TaskLifecycleState
    handoff: HandoffPayload<T>
  }): AgentMessage<T> {
    const messageId = `msg_${crypto.randomUUID()}`
    const timestampMs = Date.now()
    const deadlineRemainingMs = params.deadline.remainingMs()
    const payloadToSign = JSON.stringify({
      messageId,
      correlationId: params.correlationId,
      sender: params.sender,
      recipient: params.recipient,
      claimVersion: params.claimVersion,
      lifecycleState: params.lifecycleState,
      handoff: params.handoff,
    })
    const hmacSignature = crypto.createHmac('sha256', this.secretKey).update(payloadToSign).digest('hex')

    return Object.freeze({
      messageId,
      correlationId: params.correlationId,
      sender: params.sender,
      recipient: params.recipient,
      claimVersion: params.claimVersion,
      timestampMs,
      deadlineRemainingMs,
      lifecycleState: params.lifecycleState,
      handoff: Object.freeze(params.handoff),
      hmacSignature,
    })
  }

  public verifyEnvelope<T>(
    envelope: AgentMessage<T>,
    expectedClaimVersion: number
  ): { valid: boolean; reason?: string } {
    if (envelope.claimVersion !== expectedClaimVersion) {
      return {
        valid: false,
        reason: `SUPERSEDED_CLAIM_VERSION: message version ${envelope.claimVersion} !== active ${expectedClaimVersion}`,
      }
    }
    if (envelope.deadlineRemainingMs <= 0 || envelope.lifecycleState === 'expired') {
      return { valid: false, reason: 'MESSAGE_DEADLINE_EXPIRED' }
    }

    const payloadToSign = JSON.stringify({
      messageId: envelope.messageId,
      correlationId: envelope.correlationId,
      sender: envelope.sender,
      recipient: envelope.recipient,
      claimVersion: envelope.claimVersion,
      lifecycleState: envelope.lifecycleState,
      handoff: envelope.handoff,
    })
    const expectedHmac = crypto.createHmac('sha256', this.secretKey).update(payloadToSign).digest('hex')
    if (expectedHmac !== envelope.hmacSignature) {
      return { valid: false, reason: 'INVALID_HMAC_SIGNATURE' }
    }

    return { valid: true }
  }
}

// ============================================================================
// B2 (Ch. 2 pp. 26-30 & Ch. 4 p. 92): MultiLevelVerifier (Task, Self, Peer Models)
// ============================================================================
export class MultiLevelVerifier {
  private readonly peerCredenceScores = new Map<string, number>([
    ['RegimeAndStructureAgent', 1.0],
    ['OptionsFlowAgent', 1.0],
    ['MacroSentimentAgent', 0.85],
  ])

  private totalRuns = 0
  private totalEscalations = 0

  /**
   * Task-Model Verification: Ensures market data snapshot is complete and non-impoverished.
   */
  public verifyTaskModelInputScope(
    structure: StructureBlackboardSlice,
    options: OptionsBlackboardSlice
  ): { valid: boolean; reason?: string } {
    if (!structure.tf15m || structure.tf15m.price <= 0) {
      return { valid: false, reason: 'TASK_MODEL_IMPOVERISHED: 15m spot price missing or non-positive' }
    }
    if (!structure.tf1h || structure.tf1h.price <= 0) {
      return { valid: false, reason: 'TASK_MODEL_IMPOVERISHED: 1h timeframe missing' }
    }
    if (options.atmStrike <= 0 && options.focusedRows.length > 0) {
      return { valid: false, reason: 'TASK_MODEL_IMPOVERISHED: ATM strike missing with active option rows' }
    }
    return { valid: true }
  }

  /**
   * Self-Model Verification:
   * 1. Reasoning-Action Consistency Check (catches 13.2% MAST failure mode, Ch. 11 p. 415)
   * 2. Ground-Truth Indicator Citation Check (_validate_citations, Ch. 4 p. 92)
   */
  public verifySelfModelOutput(params: {
    bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL'
    reason: string
    citedIndicators?: CitedIndicatorMap | undefined
    structure: StructureBlackboardSlice
    options: OptionsBlackboardSlice
    macro: MacroBlackboardSlice
  }): { valid: boolean; discrepancies: string[] } {
    const discrepancies = [
      ...this.checkReasoningActionConsistency(params.bias, params.reason),
      ...this.validateCitations(params.citedIndicators, params.structure, params.options, params.macro),
    ]
    return {
      valid: discrepancies.length === 0,
      discrepancies,
    }
  }

  private checkReasoningActionConsistency(bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL', reason: string): string[] {
    const lower = (reason || '').toLowerCase()
    if (
      bias === 'BULLISH' &&
      (lower.includes('strictly bearish') || lower.includes('recommend buying puts') || lower.includes('buy_pe only'))
    ) {
      return ['SELF_MODEL_MISMATCH: Declared bias is BULLISH but reasoning recommends bearish/put execution']
    }
    if (
      bias === 'BEARISH' &&
      (lower.includes('strictly bullish') || lower.includes('recommend buying calls') || lower.includes('buy_ce only'))
    ) {
      return ['SELF_MODEL_MISMATCH: Declared bias is BEARISH but reasoning recommends bullish/call execution']
    }
    return []
  }

  private validateCitations(
    cited: CitedIndicatorMap | undefined,
    structure: StructureBlackboardSlice,
    options: OptionsBlackboardSlice,
    macro: MacroBlackboardSlice
  ): string[] {
    if (!cited) return []

    const checks: (string | null)[] = [
      cited.rsi14 !== undefined && Math.abs(cited.rsi14 - structure.tf15m.rsi14) > 3.0
        ? `CITATION_MISMATCH: Cited rsi14 (${cited.rsi14}) differs from 15m ground truth (${structure.tf15m.rsi14})`
        : null,
      cited.vwap !== undefined && Math.abs(cited.vwap - structure.tf15m.vwap) > structure.tf15m.price * 0.005
        ? `CITATION_MISMATCH: Cited vwap (${cited.vwap}) differs from 15m ground truth (${structure.tf15m.vwap})`
        : null,
      cited.pcr !== undefined && Math.abs(cited.pcr - options.pcr) > 0.25
        ? `CITATION_MISMATCH: Cited pcr (${cited.pcr}) differs from ground truth (${options.pcr})`
        : null,
      cited.gtiComposite !== undefined &&
      macro.gtiScore &&
      Math.abs(cited.gtiComposite - macro.gtiScore.composite) > 0.25
        ? `CITATION_MISMATCH: Cited gtiComposite (${cited.gtiComposite}) differs from ground truth (${macro.gtiScore.composite})`
        : null,
    ]

    return checks.filter((item): item is string => item !== null)
  }

  /**
   * Peer-Model Verification (CP-WBFT dynamic credence weighting, Ch. 2 p. 29):
   */
  public getPeerCredenceWeight(agentName: string): number {
    return this.peerCredenceScores.get(agentName) ?? 0.8
  }

  public updatePeerCredence(agentName: string, citationAccurate: boolean): number {
    const current = this.getPeerCredenceWeight(agentName)
    const updated = citationAccurate ? Math.min(1.25, current + 0.05) : Math.max(0.3, current - 0.15)
    this.peerCredenceScores.set(agentName, Number(updated.toFixed(3)))
    return updated
  }

  public recordEscalationOutcome(didEscalateOrAbstain: boolean): {
    escalationRate: number
    withinHealthyBand: boolean
  } {
    this.totalRuns += 1
    if (didEscalateOrAbstain) this.totalEscalations += 1
    const rate = this.totalRuns > 0 ? this.totalEscalations / this.totalRuns : 0
    return {
      escalationRate: Number(rate.toFixed(4)),
      withinHealthyBand: rate >= 0.02 && rate <= 0.2,
    }
  }
}

// ============================================================================
// B7 (Ch. 8 pp. 275-282): Rolling-Window CircuitBreaker & Classify-Before-Retry
// ============================================================================
export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN'

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED'
  private failureTimestamps: number[] = []
  private openedAtMs = 0
  private halfOpenProbeInFlight = false

  constructor(
    private readonly failureThreshold: number = 4,
    private readonly windowMs: number = 60000,
    private readonly cooldownMs: number = 30000
  ) {}

  public getState(): CircuitState {
    if (this.state === 'OPEN' && Date.now() - this.openedAtMs >= this.cooldownMs) {
      this.state = 'HALF_OPEN'
    }
    return this.state
  }

  public async execute<T>(operation: () => Promise<T>): Promise<T> {
    const currentState = this.getState()
    if (currentState === 'OPEN') {
      throw new Error('CIRCUIT_BREAKER_OPEN: Downstream LLM provider temporarily isolated')
    }
    if (currentState === 'HALF_OPEN') {
      if (this.halfOpenProbeInFlight) {
        throw new Error('CIRCUIT_BREAKER_HALF_OPEN_BUSY: Probe already in flight')
      }
      this.halfOpenProbeInFlight = true
    }

    try {
      const result = await operation()
      this.onSuccess()
      return result
    } catch (error) {
      this.onFailure()
      throw error
    } finally {
      if (currentState === 'HALF_OPEN') {
        this.halfOpenProbeInFlight = false
      }
    }
  }

  private onSuccess(): void {
    this.state = 'CLOSED'
    this.failureTimestamps = []
  }

  private onFailure(): void {
    const now = Date.now()
    this.failureTimestamps = [...this.failureTimestamps.filter((t) => now - t <= this.windowMs), now]
    if (this.state === 'HALF_OPEN' || this.failureTimestamps.length >= this.failureThreshold) {
      this.state = 'OPEN'
      this.openedAtMs = now
    }
  }
}

export type FailureClassification = 'TRANSIENT_NETWORK_OR_RATE_LIMIT' | 'SCHEMA_OR_SEMANTIC_OUTPUT' | 'TERMINAL_AUTH'

export class RetryAndRepairPolicy {
  public classifyError(error: unknown): FailureClassification {
    const message = error instanceof Error ? error.message : String(error)
    const lower = message.toLowerCase()
    if (lower.includes('401') || lower.includes('403') || lower.includes('api_key') || lower.includes('unauthorized')) {
      return 'TERMINAL_AUTH'
    }
    if (
      lower.includes('429') ||
      lower.includes('503') ||
      lower.includes('timeout') ||
      lower.includes('econnreset') ||
      lower.includes('rate limit')
    ) {
      return 'TRANSIENT_NETWORK_OR_RATE_LIMIT'
    }
    return 'SCHEMA_OR_SEMANTIC_OUTPUT'
  }

  public async executeWithTransientRetry<T>(
    operation: () => Promise<T>,
    maxRetries: number = 1,
    baseDelayMs: number = 150
  ): Promise<T> {
    return this.attemptOperation(operation, 0, maxRetries, baseDelayMs)
  }

  private async attemptOperation<T>(
    operation: () => Promise<T>,
    attempt: number,
    maxRetries: number,
    baseDelayMs: number
  ): Promise<T> {
    try {
      return await operation()
    } catch (err) {
      const classification = this.classifyError(err)
      if (classification !== 'TRANSIENT_NETWORK_OR_RATE_LIMIT' || attempt >= maxRetries) {
        throw err
      }
      const delayMs = baseDelayMs * Math.pow(2, attempt)
      await new Promise((resolve) => setTimeout(resolve, delayMs))
      return this.attemptOperation(operation, attempt + 1, maxRetries, baseDelayMs)
    }
  }
}

// ============================================================================
// B9 (Ch. 11 pp. 446-452): MasEvaluatorService (CoordinationMetrics & pass^k)
// ============================================================================
export class MasEvaluatorService {
  /**
   * Computes CoordinationMetrics from a completed workflow's trace spans (Ch. 11 p. 448):
   * - redundancyRatio: fraction of duplicate tool calls across spans
   * - workloadConcentration: normalized finite-sample Gini coefficient across agent token usage
   * - handoffRetention: fraction of specialist claims retained in the final synthesis
   * - convergenceRounds: number of judge/critic rounds required
   * - costPerSuccessfulOutcomeTokens: total tokens consumed
   * - passPowerK: reliability under k=3 independent trials (p^k)
   */
  public computeCoordinationMetrics(
    spans: readonly AgentTraceSpan[],
    repairAttempts: number,
    retainedSpecialistCount: number,
    totalSpecialistCount: number = 3,
    singleTrialReliability: number = 0.92,
    kTrials: number = 3
  ): CoordinationMetrics {
    const allToolKeys = spans.flatMap((s) => s.toolCalls.map((tc) => `${tc.toolName}:${JSON.stringify(tc.args)}`))
    const uniqueToolKeys = new Set(allToolKeys)
    const redundancyRatio =
      allToolKeys.length > 0 ? Number(((allToolKeys.length - uniqueToolKeys.size) / allToolKeys.length).toFixed(4)) : 0

    const tokenCounts = spans.map(
      (s) => s.otelAttributes['gen_ai.usage.input_tokens'] + s.otelAttributes['gen_ai.usage.output_tokens']
    )
    const workloadConcentration = this.computeNormalizedGini(tokenCounts)
    const handoffRetention =
      totalSpecialistCount > 0 ? Number((retainedSpecialistCount / totalSpecialistCount).toFixed(4)) : 1
    const convergenceRounds = 1 + Math.max(0, repairAttempts)
    const costPerSuccessfulOutcomeTokens = tokenCounts.reduce((sum, n) => sum + n, 0)
    const passPowerK = Number(Math.pow(Math.max(0, Math.min(1, singleTrialReliability)), kTrials).toFixed(4))

    return {
      redundancyRatio,
      workloadConcentration,
      handoffRetention,
      convergenceRounds,
      costPerSuccessfulOutcomeTokens,
      passPowerK,
    }
  }

  private computeNormalizedGini(values: readonly number[]): number {
    const n = values.length
    if (n <= 1) return 0
    const total = values.reduce((sum, v) => sum + Math.max(0, v), 0)
    if (total <= 0) return 0

    const sorted = [...values].map((v) => Math.max(0, v)).sort((a, b) => a - b)
    const weightedDiffSum = sorted.reduce((acc, xi, i) => acc + (2 * (i + 1) - n - 1) * xi, 0)
    const rawGini = weightedDiffSum / (n * total)
    const normalizedGini = rawGini * (n / (n - 1))
    return Number(Math.max(0, Math.min(1, normalizedGini)).toFixed(4))
  }
}

// ============================================================================
// B1 & B12: Pre-defined AutonomyContracts, CapabilityGrants, and TaggedValue helper
// ============================================================================
export function createTaggedValue<T>(value: T, trustLabel: TrustLabel, source: string): TaggedValue<T> {
  return Object.freeze({
    value,
    trustLabel,
    source,
    sanitizedAtMs: Date.now(),
  })
}

export const AGENT_AUTONOMY_CONTRACTS: Readonly<Record<string, AutonomyContract>> = Object.freeze({
  RegimeAndStructureAgent: {
    role: 'Price Action, Elliott Wave & Multi-Timeframe Structure Specialist',
    goal: 'Classify active regime (SCALPER vs TREND), wave phase, and structural index invalidation/targets.',
    observableState: ['structureSlice', 'rawSwingPoints15m'],
    decisionScope: ['activeRegime', 'bias', 'setup', 'candidateIndexStopLoss', 'candidateIndexTargets'],
    feedbackLoop: 'Self-Model citation verifier & Peer credence update',
    healthyEscalationBand: [0.02, 0.2],
  },
  OptionsFlowAgent: {
    role: 'NSE Options Chain, OI/COI Buildup & Greeks Specialist',
    goal: 'Determine institutional options flow bias and select optimal Gamma/Delta strike.',
    observableState: ['optionsSlice', 'rawOptionRows'],
    decisionScope: ['bias', 'recommendedStrike', 'recommendedOptionAction', 'ivCrushRisk', 'thetaDecayRisk'],
    feedbackLoop: 'Self-Model PCR citation verifier & 2nd-Order Taylor payoff check',
    healthyEscalationBand: [0.02, 0.2],
  },
  MacroSentimentAgent: {
    role: 'Volatility (India VIX), News Sentiment & GTI Institutional Order Flow Specialist',
    goal: 'Assess macro tail-risk and institutional flow alignment.',
    observableState: ['macroSlice'],
    decisionScope: ['bias', 'vixRegime', 'institutionalFlowAligned', 'vetoRecommended'],
    feedbackLoop: 'GTI composite citation check',
    healthyEscalationBand: [0.02, 0.2],
  },
  AdversarialCriticAgent: {
    role: 'Pre-Mortem Red-Team Critic & Flow Contradiction Detector',
    goal: 'Challenge specialist consensus using disjoint evidence (past regime failures, flow divergence, R:R math).',
    observableState: ['structureEnvelope', 'optionsEnvelope', 'macroEnvelope', 'conflictMatrix', 'memoryContextTagged'],
    decisionScope: ['verdict', 'recommendedConfidenceAdjustment', 'mandatoryConditions'],
    feedbackLoop: 'False-positive/false-negative veto tracking',
    healthyEscalationBand: [0.05, 0.3],
  },
  ConsensusJudgeAgent: {
    role: 'Final Trade Synthesis & Risk-Bounded Execution Judge',
    goal: 'Synthesize verified specialist claims and critic pre-mortem into a mathematically valid trade plan.',
    observableState: ['preFlightGates', 'structureEnvelope', 'optionsEnvelope', 'macroEnvelope', 'criticEnvelope'],
    decisionScope: ['decision', 'optionAction', 'strike', 'entry', 'stopLoss', 'targets', 'riskRewardRatio'],
    feedbackLoop: 'Ordered Runtime Policy Gate & 1-Shot Math/Schema Repair',
    healthyEscalationBand: [0.05, 0.25],
  },
})

export function buildAgentCapabilityGrant(
  agentName: string,
  claimVersion: number,
  allowedTools: readonly string[],
  readableSlices: readonly string[],
  writableFields: readonly string[]
): CapabilityGrant {
  const now = Date.now()
  return Object.freeze({
    grantId: `grant_${agentName}_v${claimVersion}_${now}`,
    granteeAgent: agentName,
    issuer: 'TradingMASOrchestrator',
    allowedTools,
    readableSlices,
    writableFields,
    maxToolCalls: 3,
    maxTokens: 12000,
    issuedAtMs: now,
    expiresAtMs: now + 25000,
    claimVersionBound: claimVersion,
    delegationDepth: 1,
  })
}
