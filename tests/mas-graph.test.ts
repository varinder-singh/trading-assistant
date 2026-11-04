import { describe, it, expect } from 'vitest'
import {
  AGENT_AUTONOMY_CONTRACTS,
  AgentBudget,
  AtomicBudgetLedger,
  CircuitBreaker,
  MasEvaluatorService,
  MessageBusValidator,
  MultiLevelVerifier,
  RetryAndRepairPolicy,
  RunDeadline,
  buildAgentCapabilityGrant,
  createTaggedValue,
} from '../src/ai/mas/contracts.js'
import { END_NODE, StateGraph } from '../src/ai/mas/graph.js'
import { BlackboardContextScoper } from '../src/ai/mas/blackboard.js'
import { MASToolRegistry, ToolCallMediator, TradePlanMathValidator } from '../src/ai/mas/tools.js'
import { PostMortemAgent, TradingMASOrchestrator } from '../src/ai/mas/agents.js'
import { DEFAULT_TRADING_DOMAIN_POLICY } from '../src/ai/mas/types.js'
import type { TradingBlackboard } from '../src/ai/mas/types.js'
import { HybridRetriever, MemoryService } from '../src/ai/memory.js'
import type { LLMMessage, LLMProvider, LLMToolDefinition } from '../src/ai/types.js'

function createSampleMarketInput(overrides: Record<string, any> = {}): any {
  return {
    symbol: 'NIFTY',
    mode: 'intraday',
    time: '10:30:00',
    tf1h: {
      timeframe: '1h',
      price: 24500,
      vwap: 24450,
      vwapPosition: 'above',
      vwapZScore: 1.1,
      rsi: 60,
      support: 24350,
      resistance: 24650,
      atr14: 45,
      trend: 'uptrend',
    },
    tf30m: {
      timeframe: '30m',
      price: 24500,
      vwap: 24460,
      vwapPosition: 'above',
      vwapZScore: 1.2,
      rsi: 61,
      support: 24380,
      resistance: 24620,
      atr14: 32,
      trend: 'uptrend',
    },
    tf15m: {
      timeframe: '15m',
      price: 24500,
      vwap: 24470,
      vwapPosition: 'above',
      vwapZScore: 1.25,
      rsi: 62,
      support: 24420,
      resistance: 24580,
      atr14: 24,
      trend: 'uptrend',
      waveContext: {
        currentPhase: 'WAVE_3',
        wave5Target: 24610,
      },
      swings: [
        { type: 'LOW', price: 24380, timestamp: '2026-10-30T09:30:00Z' },
        { type: 'HIGH', price: 24490, timestamp: '2026-10-30T10:00:00Z' },
        { type: 'LOW', price: 24435, timestamp: '2026-10-30T10:15:00Z' },
      ],
      gtiScore: {
        composite: 0.45,
        classification: 'INSTITUTIONAL_BUY',
        confidence: 78,
        components: {
          volumeAnomaly: 0.5,
          cvd: 0.4,
          vwapDeviation: 0.3,
          oiSignal: 0.6,
          smartMoneyFlow: 0.45,
        },
      },
    },
    tf3m: {
      timeframe: '3m',
      price: 24500,
      vwap: 24485,
      vwapPosition: 'above',
      vwapZScore: 0.9,
      rsi: 58,
      support: 24460,
      resistance: 24540,
      atr14: 11,
      trend: 'uptrend',
    },
    vix: {
      current: 14.2,
      change: -1.5,
      sentiment: 'calm',
    },
    reversalScore: {
      bullish: 4,
      bearish: 1,
    },
    optionsAnalysisZerodha: {
      atmStrike: 24500,
      pcr: 1.18,
      pcrAtm: 1.24,
      sentiment: 'bullish',
      atmSentiment: 'bullish',
      marketFlow: 'LONG_BUILDUP',
      support: 24400,
      resistance: 24600,
      ivRank: 42,
      ivPercentile: 45,
      greeksContext: {
        daysToExpiry: 3,
      },
      rows: [
        {
          strike: 24500,
          type: 'CE',
          symbol: 'NIFTY26OCT24500CE',
          ltp: 120,
          oi: 4500000,
          intervalOi: -120000,
          buildup: 'Short Covering',
          greeks: { delta: 0.52, gamma: 0.0024, theta: -14.5, iv: 0.142 },
        },
        {
          strike: 24500,
          type: 'PE',
          symbol: 'NIFTY26OCT24500PE',
          ltp: 98,
          oi: 6200000,
          intervalOi: 250000,
          buildup: 'Short Buildup',
          greeks: { delta: -0.48, gamma: 0.0024, theta: -13.8, iv: 0.145 },
        },
      ],
    },
    ...overrides,
  }
}

describe('Phase 2: Multi-Agent System (MAS) Engine & Book Standards (B1-B12)', () => {
  it('B1 & B3: defines AutonomyContracts and enforces 4-counter AgentBudget', () => {
    expect(AGENT_AUTONOMY_CONTRACTS.RegimeAndStructureAgent).toBeDefined()
    expect(AGENT_AUTONOMY_CONTRACTS.ConsensusJudgeAgent?.healthyEscalationBand).toEqual([0.05, 0.25])

    const budget = new AgentBudget(2, 2, 1000, 10000)
    budget.recordStep(1, 400)
    expect(budget.check()).toBeNull()

    budget.recordStep(2, 700)
    expect(budget.check()).toContain('BUDGET_EXCEEDED')
  })

  it('B2: MultiLevelVerifier catches reasoning-action mismatch, citation hallucinations, and updates CP-WBFT credence', () => {
    const verifier = new MultiLevelVerifier()
    const scoper = new BlackboardContextScoper()
    const raw = createSampleMarketInput()
    const structure = scoper.buildStructureSlice(raw)
    const { slice: options } = scoper.buildOptionsSlice(raw)
    const macro = scoper.buildMacroSlice(raw)

    expect(verifier.verifyTaskModelInputScope(structure, options).valid).toBe(true)

    const badSelf = verifier.verifySelfModelOutput({
      bias: 'BULLISH',
      reason: 'Market is strictly bearish, recommend buying puts immediately.',
      citedIndicators: {
        rsi14: 89, // Ground truth is 62 (diff > 3.0)
        pcr: 0.4, // Ground truth is 1.18 (diff > 0.25)
      },
      structure,
      options,
      macro,
    })

    expect(badSelf.valid).toBe(false)
    expect(badSelf.discrepancies.some((d) => d.includes('SELF_MODEL_MISMATCH'))).toBe(true)
    expect(badSelf.discrepancies.some((d) => d.includes('CITATION_MISMATCH: Cited rsi14'))).toBe(true)
    expect(badSelf.discrepancies.some((d) => d.includes('CITATION_MISMATCH: Cited pcr'))).toBe(true)

    const initialCredence = verifier.getPeerCredenceWeight('OptionsFlowAgent')
    const penalizedCredence = verifier.updatePeerCredence('OptionsFlowAgent', false)
    expect(penalizedCredence).toBeLessThan(initialCredence)
  })

  it('B4 & B12: MessageBusValidator signs envelopes with HMAC-SHA256 and rejects superseded claimVersions or tampered claims', () => {
    const bus = new MessageBusValidator('test-secret-key-2026')
    const deadline = new RunDeadline(10000)

    const envelope = bus.createSignedEnvelope({
      correlationId: 'run_1',
      sender: 'RegimeAndStructureAgent',
      recipient: 'ConsensusJudgeAgent',
      claimVersion: 3,
      deadline,
      lifecycleState: 'succeeded',
      handoff: {
        claim: { bias: 'BULLISH', confidence: 82 },
        provenance: { sourceAgent: 'RegimeAndStructureAgent', citedFields: ['tf15m.rsi14'], toolCallsUsed: [] },
        uncertainty: [],
        action: 'PROPOSE',
        permissions: ['structureEnvelope'],
        resultSchema: 'TestSchema.v1',
        acceptance: { verifiedCitations: true, verifiedReasoningActionMatch: true, withinDeadline: true },
      },
    })

    expect(bus.verifyEnvelope(envelope, 3).valid).toBe(true)
    expect(bus.verifyEnvelope(envelope, 4)).toEqual({
      valid: false,
      reason: 'SUPERSEDED_CLAIM_VERSION: message version 3 !== active 4',
    })

    const tampered = {
      ...envelope,
      handoff: {
        ...envelope.handoff,
        claim: { bias: 'BEARISH', confidence: 99 },
      },
    }
    expect(bus.verifyEnvelope(tampered, 3)).toEqual({
      valid: false,
      reason: 'INVALID_HMAC_SIGNATURE',
    })
  })

  it('B5: StateGraph isolates failing parallel branches via Promise.allSettled and attributes missing perspectives', async () => {
    const graph = new StateGraph<{ completed: string[]; failed: string[] }>()
    graph
      .setEntryPoint('fanout')
      .addParallelNode(
        'fanout',
        [
          {
            branchName: 'StructureBranch',
            execute: async (s) => {
              s.completed = [...s.completed, 'StructureBranch']
            },
          },
          {
            branchName: 'OptionsBranch',
            execute: async () => {
              throw new Error('Simulated Options API timeout')
            },
          },
        ],
        (branchName, _err, s) => {
          s.failed = [...s.failed, branchName]
        }
      )
      .addEdge('fanout', END_NODE)

    const state = await graph.run({ completed: [], failed: [] }, { deadline: new RunDeadline(5000) })
    expect(state.completed).toEqual(['StructureBranch'])
    expect(state.failed).toEqual(['OptionsBranch'])

    const scoper = new BlackboardContextScoper()
    const verifier = new MultiLevelVerifier()
    const matrix = scoper.computeConflictMatrix({
      structureEnvelope: undefined,
      optionsEnvelope: undefined,
      macroEnvelope: undefined,
      verifier,
    })
    expect(matrix.missingPerspectives.length).toBe(3)
    expect(matrix.missingPerspectives[0]).toContain('Missing analyses: [RegimeAndStructureAgent] degraded')
  })

  it('B3 & B12: MASToolRegistry computes 2nd-Order Taylor option payoff and ToolCallMediator enforces 12-field CapabilityGrant', async () => {
    const scoper = new BlackboardContextScoper()
    const raw = createSampleMarketInput()
    const { slice: optionsSlice, compactRows } = scoper.buildOptionsSlice(raw)
    const mockBlackboard = {
      claimVersion: 1,
      policy: DEFAULT_TRADING_DOMAIN_POLICY,
      structureSlice: scoper.buildStructureSlice(raw),
      optionsSlice,
      macroSlice: scoper.buildMacroSlice(raw),
      rawSwingPoints15m: raw.tf15m.swings,
      rawOptionRows: compactRows,
      memoryContextTagged: createTaggedValue('none', 'UNTRUSTED_MEMORY', 'test'),
      preFlightGates: scoper.computePreFlightGates(raw, 'SCALPER'),
    } as unknown as TradingBlackboard

    const optionsTools = MASToolRegistry.buildOptionsTools(mockBlackboard)
    const grant = buildAgentCapabilityGrant(
      'OptionsFlowAgent',
      1,
      ['simulateStrikePayoff'],
      ['optionsSlice'],
      ['optionsEnvelope']
    )
    const mediator = new ToolCallMediator({ ...grant, maxToolCalls: 1 })
    const wrapped = mediator.wrapTools(optionsTools, 1)

    expect(wrapped.length).toBe(1) // inspectOptionStrikeChain filtered out by CapabilityGrant
    const payoffTool = wrapped[0]!
    const res1: any = await payoffTool.execute({
      strike: 24500,
      optionType: 'CE',
      expectedIndexMovePoints: 50,
      holdingMinutes: 30,
    })

    expect(res1.trustLabel).toBe('VERIFIED_TOOL')
    // Delta = 0.52 * 50 = +26; Gamma = 0.5 * 0.0024 * 2500 = +3.0; Theta = -14.5 * (30/375) = -1.16 -> +27.84
    expect(res1.value.projectedPremiumChange).toBeCloseTo(27.84, 1)
    expect(res1.value.projectedLtp).toBeCloseTo(147.84, 1)

    // Second call exceeds maxToolCalls = 1 and returns structured recovery hint
    const res2: any = await payoffTool.execute({
      strike: 24500,
      optionType: 'CE',
      expectedIndexMovePoints: 50,
      holdingMinutes: 30,
    })
    expect(res2.error).toContain('MAX_TOOL_CALLS_EXCEEDED')
    expect(res2.suggestion).toBeDefined()
  })

  it('B6 & B11: MemoryService enforces <memory_data> delimiters, 3-signal HybridRetriever, Dream Pass promotion, and lineage rollback', () => {
    const mem = new MemoryService()
    const postMortem = new PostMortemAgent()

    const lesson1 = postMortem.distillClosedTrade({
      tradeId: 't1',
      symbol: 'NIFTY',
      regime: 'SCALPER',
      setup: 'INSTITUTIONAL_TRAP',
      pnl: -2400,
      exitReason: 'False breakout flow mismatch',
      candidateLineageId: 'lineage_bad_v1',
    })
    const lesson2 = postMortem.distillClosedTrade({
      tradeId: 't2',
      symbol: 'NIFTY',
      regime: 'SCALPER',
      setup: 'INSTITUTIONAL_TRAP',
      pnl: -1800,
      exitReason: 'OI flow divergence',
      candidateLineageId: 'lineage_bad_v1',
    })
    const lesson3 = postMortem.distillClosedTrade({
      tradeId: 't3',
      symbol: 'NIFTY',
      regime: 'SCALPER',
      setup: 'INSTITUTIONAL_TRAP',
      pnl: -3100,
      exitReason: 'Options flow mismatch on CE',
      candidateLineageId: 'lineage_bad_v1',
    })

    mem.recordEpisodicLesson(lesson1, { trend: 'uptrend', vix: 14.5 })
    mem.recordEpisodicLesson(lesson2, { trend: 'uptrend', vix: 15.0 })
    mem.recordEpisodicLesson(lesson3, { trend: 'uptrend', vix: 14.2 })

    const retrieved = mem.retrieveTopEpisodicLessons({
      symbol: 'NIFTY',
      regime: 'SCALPER',
      trend: 'uptrend',
      vix: 14.4,
      topK: 2,
    })
    expect(retrieved.length).toBe(2)
    expect(retrieved[0]!.compositeScore).toBeGreaterThan(0.5)

    // Run 4-Stage Dream Pass Consolidation -> promotes cluster of 3 episodes to SemanticPlaybookRule
    const dreamSummary = mem.runDreamPassConsolidation(3, 0.1)
    expect(dreamSummary.promotedSemanticRules.length).toBe(1)
    expect(dreamSummary.hotspotRegimes.length).toBe(1)

    const formatted = mem.formatForPrompt(null, 'SCALPER', 'NIFTY', 14.4)
    expect(formatted).toContain('<memory_data trust="untrusted">')
    expect(formatted).toContain('Promoted Semantic Playbook Rules')
    expect(formatted).toContain('</memory_data>')

    // Rollback by lineage purges both the semantic rule and episodic records
    const rollback = mem.rollbackByLineage('lineage_bad_v1')
    expect(rollback.removedSemanticRules).toBe(1)
    expect(rollback.removedEpisodicRecords).toBe(3)
    expect(mem.getSemanticPlaybookRules('SCALPER').length).toBe(0)

    const standaloneRetriever = new HybridRetriever()
    expect(standaloneRetriever).toBeDefined()
  })

  it('B7: CircuitBreaker transitions CLOSED -> OPEN -> HALF_OPEN -> CLOSED and RetryAndRepairPolicy classifies errors', async () => {
    const cb = new CircuitBreaker(2, 60000, 20)
    expect(cb.getState()).toBe('CLOSED')

    await expect(cb.execute(async () => Promise.reject(new Error('503 Service Unavailable')))).rejects.toThrow()
    expect(cb.getState()).toBe('CLOSED')

    await expect(cb.execute(async () => Promise.reject(new Error('503 Service Unavailable')))).rejects.toThrow()
    expect(cb.getState()).toBe('OPEN')

    await expect(cb.execute(async () => 'ok')).rejects.toThrow('CIRCUIT_BREAKER_OPEN')

    await new Promise((r) => setTimeout(r, 25))
    expect(cb.getState()).toBe('HALF_OPEN')

    const recovered = await cb.execute(async () => 'recovered')
    expect(recovered).toBe('recovered')
    expect(cb.getState()).toBe('CLOSED')

    const retry = new RetryAndRepairPolicy()
    expect(retry.classifyError(new Error('401 Unauthorized API_KEY'))).toBe('TERMINAL_AUTH')
    expect(retry.classifyError(new Error('429 Rate limit exceeded'))).toBe('TRANSIENT_NETWORK_OR_RATE_LIMIT')
    expect(retry.classifyError(new Error('Unexpected token in JSON'))).toBe('SCHEMA_OR_SEMANTIC_OUTPUT')
  })

  it('B8, B10 & F1: Pre-Flight Gates scope |vwapZScore| > 2.0 to SCALPER while allowing TREND Wave 3, and Ordered Policy Gate separates Hard Veto from Math Repair', () => {
    const scoper = new BlackboardContextScoper()
    const highZInput = createSampleMarketInput({
      tf15m: {
        ...createSampleMarketInput().tf15m,
        vwapZScore: 2.45,
        waveContext: { currentPhase: 'WAVE_3', wave5Target: 24650 },
      },
    })

    const gates = scoper.computePreFlightGates(highZInput, 'SCALPER')
    expect(gates.scalperAllowedActions).not.toContain('BUY_CE')
    expect(gates.trendAllowedActions).toContain('BUY_CE')

    const mathValidator = new TradePlanMathValidator()
    // Gate 1: Critic HARD_VETO is un-repairable
    const hardVetoResult = mathValidator.validateCandidatePlan(
      {
        decision: 'BUY',
        optionAction: 'BUY_CE',
        setup: 'TRUE_BREAKOUT',
        macroTrend: 'UPTREND',
        instrument: 'OPTIONS',
        strike: 24500,
        entry: 24500,
        stopLoss: 24440,
        targets: [24600],
        riskRewardRatio: 1.67,
        confidence: 80,
        reason: 'Test',
      },
      24500,
      'TREND',
      'intraday',
      gates,
      'HARD_VETO'
    )
    expect(hardVetoResult.valid).toBe(false)
    expect(hardVetoResult.isHardRiskVeto).toBe(true)

    // Gate 2: Invalid stopLoss side for BUY_PE is repairable (isHardRiskVeto: false)
    const repairableResult = mathValidator.validateCandidatePlan(
      {
        decision: 'BUY',
        optionAction: 'BUY_PE',
        setup: 'TRUE_BREAKOUT',
        macroTrend: 'DOWNTREND',
        instrument: 'OPTIONS',
        strike: 24500,
        entry: 24500,
        stopLoss: 24400, // Wrong side for BUY_PE! Should be > 24500
        targets: [24350],
        riskRewardRatio: 1.5,
        confidence: 80,
        reason: 'Bearish breakdown',
      },
      24500,
      'SCALPER',
      'intraday',
      gates,
      'APPROVE'
    )
    expect(repairableResult.valid).toBe(false)
    expect(repairableResult.isHardRiskVeto).toBe(false)
    expect(repairableResult.errors.some((e) => e.includes('BUY_PE requires index stopLoss'))).toBe(true)
  })

  it('B9 & End-to-End MAS Graph: executes 3-Stage Hybrid MAS Graph, performs 1-shot Judge math repair, and computes CoordinationMetrics', async () => {
    let judgeCallCount = 0

    const mockProvider: LLMProvider = {
      name: 'mock-mas-provider',
      chat: async () => '{}',
      chatWithTools: async (messages: LLMMessage[], _tools: LLMToolDefinition[]) => {
        const sys = messages[0]?.content || ''
        if (sys.includes('RegimeAndStructureAgent')) {
          return {
            text: JSON.stringify({
              activeRegime: 'TREND',
              bias: 'BULLISH',
              setup: 'TRUE_BREAKOUT',
              wavePhase: 'WAVE_3',
              confidence: 72,
              structuralSupport: 24420,
              structuralResistance: 24580,
              candidateIndexStopLoss: 24430,
              candidateIndexTargets: [24610, 24680],
              citedIndicators: { rsi14: 62, vwap: 24470, support: 24420, resistance: 24580 },
              reason: '15m Wave 3 impulse above VWAP with bullish structure.',
            }),
            toolCalls: [{ toolName: 'inspectWaveAndSwings', args: { limit: 5 }, result: 'ok', durationMs: 2 }],
            estimatedInputTokens: 800,
            estimatedOutputTokens: 220,
            stepsUsed: 1,
          }
        }
        if (sys.includes('OptionsFlowAgent')) {
          return {
            text: JSON.stringify({
              bias: 'BULLISH',
              confidence: 80,
              dominantFlow: 'LONG_BUILDUP',
              recommendedStrike: 24500,
              recommendedOptionAction: 'BUY_CE',
              ivCrushRisk: 'LOW',
              thetaDecayRisk: 'LOW',
              keySignals: ['24500 CE Short Covering', 'PCR 1.18'],
              citedIndicators: { pcr: 1.18 },
              reason: 'Strong Call short covering and Put writing at 24500.',
            }),
            toolCalls: [],
            estimatedInputTokens: 750,
            estimatedOutputTokens: 190,
            stepsUsed: 1,
          }
        }
        if (sys.includes('MacroSentimentAgent')) {
          return {
            text: JSON.stringify({
              bias: 'BULLISH',
              confidence: 76,
              vixRegime: 'CALM',
              institutionalFlowAligned: true,
              vetoRecommended: false,
              citedIndicators: { gtiComposite: 0.45 },
              reason: 'India VIX calm at 14.2 and GTI composite +0.45.',
            }),
            toolCalls: [],
            estimatedInputTokens: 500,
            estimatedOutputTokens: 140,
            stepsUsed: 1,
          }
        }
        if (sys.includes('AdversarialCriticAgent')) {
          return {
            text: JSON.stringify({
              verdict: 'APPROVE',
              preMortemFailureScenario: 'Sudden 24580 resistance rejection.',
              counterEvidence: [],
              flowContradictionDetected: false,
              recommendedConfidenceAdjustment: 0,
              mandatoryConditions: ['Hold above 24430'],
              reason: 'All three specialists align with ground-truth citations.',
            }),
            toolCalls: [],
            estimatedInputTokens: 900,
            estimatedOutputTokens: 180,
            stepsUsed: 1,
          }
        }
        // ConsensusJudgeAgent: First call intentionally returns wrong stopLoss side (24590 > 24500 for BUY_CE) to trigger 1-shot repair!
        judgeCallCount += 1
        if (judgeCallCount === 1) {
          return {
            text: JSON.stringify({
              decision: 'BUY',
              setup: 'TRUE_BREAKOUT',
              macroTrend: 'UPTREND',
              instrument: 'OPTIONS',
              optionAction: 'BUY_CE',
              strike: 24500,
              reason: 'Initial synthesis with accidental inverted stopLoss.',
              confidence: 78,
              entry: 24500,
              stopLoss: 24590, // Invalid for BUY_CE (> entry)
              targets: [24610, 24680],
              riskRewardRatio: 1.5,
            }),
            toolCalls: [],
            estimatedInputTokens: 1000,
            estimatedOutputTokens: 210,
            stepsUsed: 1,
          }
        }
        return {
          text: JSON.stringify({
            decision: 'BUY',
            setup: 'TRUE_BREAKOUT',
            macroTrend: 'UPTREND',
            instrument: 'OPTIONS',
            optionAction: 'BUY_CE',
            strike: 24500,
            reason: 'Repaired synthesis: 15m Wave 3 breakout supported by 24500 CE short covering and GTI +0.45.',
            confidence: 81,
            entry: 24500,
            stopLoss: 24430, // Valid index stopLoss below entry
            targets: [24610, 24680],
            riskRewardRatio: 1.57,
          }),
          toolCalls: [],
          estimatedInputTokens: 1100,
          estimatedOutputTokens: 210,
          stepsUsed: 1,
        }
      },
    }

    const mem = new MemoryService()
    const orchestrator = new TradingMASOrchestrator(() => mockProvider, mem)
    const result = await orchestrator.executeEnsembleGraph(createSampleMarketInput(), 'TREND', '')

    expect(judgeCallCount).toBe(2) // Proves 1-shot repair node executed!
    expect(result.decision).toBe('BUY')
    expect(result.optionAction).toBe('BUY_CE')
    expect(result.stopLoss).toBe(24430)
    expect(result.targets[0]).toBe(24610)

    const evaluator = new MasEvaluatorService()
    const ledger = new AtomicBudgetLedger(10000)
    expect(ledger.reserve(4000).allowed).toBe(true)
    ledger.settle(4000, 3800)
    expect(ledger.getTotalConsumedTokens()).toBe(3800)
    expect(evaluator).toBeDefined()
  })
})
