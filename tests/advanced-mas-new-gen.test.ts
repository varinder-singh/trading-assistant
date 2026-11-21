import { describe, it, expect } from 'vitest'
import { MASToolRegistry } from '../src/ai/mas/tools.js'
import { DialecticCouncilAgent, PositionGuardianAgent, TradingMASOrchestrator } from '../src/ai/mas/agents.js'
import { AtomicBudgetLedger } from '../src/ai/mas/contracts.js'
import { DEFAULT_TRADING_DOMAIN_POLICY } from '../src/ai/mas/types.js'
import type { TradingBlackboard } from '../src/ai/mas/types.js'
import { MemoryService } from '../src/ai/memory.js'
import type { LLMProvider } from '../src/ai/types.js'

function buildMockBlackboard(overrides: Partial<TradingBlackboard> = {}): TradingBlackboard {
  const defaultStructureSlice: any = {
    symbol: 'NIFTY',
    mode: 'intraday',
    istTime: '10:30:00',
    tf1h: { price: 24500, vwap: 24450, rsi14: 60, trend: 'uptrend' },
    tf30m: { price: 24500, vwap: 24460, rsi14: 61, trend: 'uptrend' },
    tf15m: {
      price: 24500,
      vwap: 24470,
      rsi14: 62,
      trend: 'uptrend',
      wavePhase: 'WAVE_3',
      wave5Target: 24650,
      fibZones: { wave2RetracementMin: 24350, wave2RetracementMax: 24400, wave4RetracementMax: 24480 },
    },
    tf5m: { price: 24500, vwap: 24485, rsi14: 58, trend: 'uptrend' },
    reversalScore: { bullish: 4, bearish: 1 },
    dailyContext: { atr14: 250, pdh: 24600, pdl: 24300, pdc: 24450, pdr: 300, isCompression: false },
    omittedContextManifest: [],
    liveTrigger: {
      reason: 'Support Break',
      lastPrice: 24500,
      downsampledTicks: [24480, 24490, 24500],
    },
  }

  const defaultOptionsSlice: any = {
    symbol: 'NIFTY',
    spotPrice: 24500,
    atmStrike: 24500,
    pcr: 1.25,
    pcrAtm: 1.3,
    sentiment: 'BULLISH',
    atmSentiment: 'BULLISH',
    marketFlow: 'CALL_BUYING',
    supportWall: 24300,
    resistanceWall: 24700,
    ivRank: 22,
    ivPercentile: 25,
    daysToExpiry: 3.5,
  }

  const defaultMacroSlice: any = {
    vix: { current: 13.5, change: -1.2, regime: 'CALM' },
    newsSentiment: { sentiment: 'BULLISH', score: 0.8 },
    gtiScore: { composite: 0.5, classification: 'INSTITUTIONAL_BUY', confidence: 85, components: {} },
    omittedContextManifest: [],
  }

  return {
    runId: 'mas_test_run_001',
    claimVersion: 1,
    symbol: 'NIFTY',
    userId: 'test_user',
    startedAtMs: Date.now(),
    deadlineMs: 25000,
    policy: DEFAULT_TRADING_DOMAIN_POLICY,
    taskContract: {
      contractId: 'tc_001',
      objective: 'Test MAS',
      constraints: [],
      successCriteria: [],
      escalationTrigger: 'Abstain',
    },
    preFlightGates: {
      isBlocked: false,
      blockReasons: [],
      allowedActions: ['BUY_CE', 'BUY_PE'],
      scalperAllowedActions: ['BUY_CE'],
      trendAllowedActions: ['BUY_CE'],
      trapAllowedActions: [],
      reducedSizingMandatory: false,
      cautionNotes: [],
    },
    structureSlice: defaultStructureSlice,
    optionsSlice: defaultOptionsSlice,
    macroSlice: defaultMacroSlice,
    rawSwingPoints15m: [],
    rawOptionRows: [
      {
        strike: 24500,
        type: 'CE',
        symbol: 'NIFTY26NOV24500CE',
        ltp: 120,
        oi: 5000000,
        intervalOi: 200000,
        buildup: 'LONG_BUILDUP',
        delta: 0.52,
        gamma: 0.0012,
        theta: -8.5,
        iv: 14.5,
      },
      {
        strike: 24200,
        type: 'PE',
        symbol: 'NIFTY26NOV24200PE',
        ltp: 45,
        oi: 3500000,
        intervalOi: -50000,
        buildup: 'LONG_UNWINDING',
        delta: -0.22, // Sluggish deep OTM delta
        gamma: 0.0006,
        theta: -6.2,
        iv: 15.1,
      },
      {
        strike: 24500,
        type: 'PE',
        symbol: 'NIFTY26NOV24500PE',
        ltp: 110,
        oi: 4200000,
        intervalOi: -150000,
        buildup: 'SHORT_COVERING',
        delta: -0.48, // Responsive ATM delta
        gamma: 0.0011,
        theta: -8.1,
        iv: 14.8,
      },
    ],
    memoryContextTagged: {
      value: 'No prior loss pattern',
      trustLabel: 'VERIFIED_TOOL',
      source: 'MemoryService',
      sanitizedAtMs: Date.now(),
    },
    lifecycleState: 'succeeded',
    activeAgent: 'TREND',
    mathValidationErrors: [],
    repairAttempts: 0,
    traceSpans: [],
    ...overrides,
  }
}

describe('Advanced MAS New Gen: Living Autonomous Agents', () => {
  describe('Pillar 1: Deterministic ReAct Investigative Tools', () => {
    it('inspectSessionHorizon: warns and rejects/restricts when runway before 3:15 PM EOD square-off is tight', () => {
      // 1. Ample runway at 10:30 AM IST (285 minutes left)
      const blackboardAmple = buildMockBlackboard()
      const toolsAmple = MASToolRegistry.buildStructureTools(blackboardAmple)
      const horizonToolAmple = toolsAmple.find((t) => t.name === 'inspectSessionHorizon')!
      expect(horizonToolAmple).toBeDefined()
      const resultAmple: any = horizonToolAmple.execute({})
      expect(resultAmple.timeToSquareOffMins).toBe(285)
      expect(resultAmple.isClosingRunwayRisk).toBe(false)
      expect(resultAmple.recommendation).toBe('ALLOW_ALL')

      // 2. Late-day runway hazard at 14:45 IST (30 minutes left before 15:15 square-off)
      const blackboardLate = buildMockBlackboard({
        structureSlice: {
          ...buildMockBlackboard().structureSlice,
          istTime: '14:45:00',
        },
      })
      const toolsLate = MASToolRegistry.buildStructureTools(blackboardLate)
      const horizonToolLate = toolsLate.find((t) => t.name === 'inspectSessionHorizon')!
      const resultLate: any = horizonToolLate.execute({})
      expect(resultLate.timeToSquareOffMins).toBe(30)
      expect(resultLate.isClosingRunwayRisk).toBe(true)
      expect(resultLate.recommendation).toBe('SCALP_ONLY_TIGHT_SL')

      // 3. Imminent square-off at 15:05 IST (10 minutes left)
      const blackboardImminent = buildMockBlackboard({
        structureSlice: {
          ...buildMockBlackboard().structureSlice,
          istTime: '15:05:00',
        },
      })
      const toolsImminent = MASToolRegistry.buildStructureTools(blackboardImminent)
      const horizonToolImminent = toolsImminent.find((t) => t.name === 'inspectSessionHorizon')!
      const resultImminent: any = horizonToolImminent.execute({})
      expect(resultImminent.timeToSquareOffMins).toBe(10)
      expect(resultImminent.recommendation).toBe('REJECT_NEW_ENTRIES')
    })

    it('inspectSectorBreadthAndBeta: detects counter-trend divergence when stock lags while broad market is risk-on', () => {
      // Stock below VWAP while benchmark is bullish (CIPLA failure mode)
      const baseBlackboard = buildMockBlackboard()
      const blackboard = buildMockBlackboard({
        symbol: 'CIPLA',
        structureSlice: {
          ...baseBlackboard.structureSlice,
          tf15m: {
            ...baseBlackboard.structureSlice.tf15m,
            price: 1407,
            vwap: 1412, // price < vwap
            rsi14: 42,
            trend: 'downtrend',
          },
        },
        macroSlice: {
          ...baseBlackboard.macroSlice,
          vix: { current: 12.5, change: -0.5, sentiment: 'CALM' },
          gtiScore: { composite: 0.6, classification: 'INSTITUTIONAL_BUY', confidence: 90, components: {} as any },
        },
      })

      const tools = MASToolRegistry.buildStructureTools(blackboard)
      const sectorTool = tools.find((t) => t.name === 'inspectSectorBreadthAndBeta')!
      expect(sectorTool).toBeDefined()
      const res: any = sectorTool.execute({ symbol: 'CIPLA' })

      expect(res.sectorAlignment).toBe('DIVERGENT')
      expect(res.recommendation).toBe('VETO_COUNTER_TREND')
      expect(res.note).toContain('Shorting into market strength has low expectancy')
    })

    it('inspectOptionVelocity: detects vertical spike extension and mandates pending pullback limit', () => {
      // Simulate vertical tick surge (>0.15% in 1m window)
      const blackboard = buildMockBlackboard({
        structureSlice: {
          ...buildMockBlackboard().structureSlice,
          liveTrigger: {
            reason: 'Volatility Spike',
            lastPrice: 24550,
            downsampledTicks: [24480, 24510, 24550], // +0.28% vertical surge
          },
        },
      })

      const tools = MASToolRegistry.buildOptionsTools(blackboard)
      const velocityTool = tools.find((t) => t.name === 'inspectOptionVelocity')!
      expect(velocityTool).toBeDefined()
      const res: any = velocityTool.execute({ strike: 24500, optionType: 'CE' })

      expect(res.isHyperExtended).toBe(true)
      expect(res.executionRecommendation).toBe('QUEUE_PULLBACK_LIMIT')
      expect(res.suggestedLimitPrice).toBeLessThan(res.currentLtp)
      expect(res.rationale).toContain('Do not chase market buy')
    })

    it('inspectDynamicGreeksSurface: flags deep OTM low-delta drag and recommends responsive ATM alternative', () => {
      const blackboard = buildMockBlackboard({
        optionsSlice: {
          ...buildMockBlackboard().optionsSlice,
          daysToExpiry: 4.2, // Multi-day contract
        },
      })

      const tools = MASToolRegistry.buildOptionsTools(blackboard)
      const greeksTool = tools.find((t) => t.name === 'inspectDynamicGreeksSurface')!
      expect(greeksTool).toBeDefined()

      // Inspect deep OTM 24200 PE (delta = -0.22)
      const resOtm: any = greeksTool.execute({ strike: 24200, optionType: 'PE' })
      expect(resOtm.isDeltaLowRisk).toBe(true)
      expect(resOtm.recommendedStrike).toBe(24500) // Recommends ATM strike (delta = -0.48)
      expect(resOtm.rationale).toContain('Risk of premature shakeout and missed ratchets')

      // Inspect ATM 24500 CE (delta = 0.52)
      const resAtm: any = greeksTool.execute({ strike: 24500, optionType: 'CE' })
      expect(resAtm.isDeltaLowRisk).toBe(false)
      expect(resAtm.recommendedStrike).toBe(24500)
    })
  })

  describe('Pillar 2: Dialectic Deliberation Council', () => {
    it('fast-paths when all specialists agree and critic issues an un-conflicted APPROVE', async () => {
      const council = new DialecticCouncilAgent()
      const ledger = new AtomicBudgetLedger(10000)
      const mockProvider: LLMProvider = {
        name: 'mock',
        chat: async () => {
          throw new Error('Should not invoke LLM on fast path')
        },
      }

      const blackboard = buildMockBlackboard({
        conflictMatrix: {
          unanimousDirection: 'BULLISH',
          hasDirectConflict: false,
          conflicts: [],
          missingPerspectives: [],
          weightedBullishScore: 88,
          weightedBearishScore: 10,
          highestConvictionAgent: 'StructureSpecialist',
        },
        criticEnvelope: {
          messageId: 'msg_critic_1',
          correlationId: 'mas_test_1',
          sender: 'AdversarialCriticAgent',
          recipient: 'TradingBlackboard',
          claimVersion: 1,
          timestampMs: Date.now(),
          deadlineRemainingMs: 20000,
          lifecycleState: 'succeeded',
          handoff: {
            claim: {
              verdict: 'APPROVE',
              preMortemFailureScenario: 'None',
              counterEvidence: [],
              flowContradictionDetected: false,
              recommendedConfidenceAdjustment: 0,
              mandatoryConditions: ['Hold above VWAP'],
              reason: 'Clean setup',
            },
            provenance: { sourceAgent: 'AdversarialCriticAgent', citedFields: [], toolCallsUsed: [] },
            uncertainty: [],
            action: 'SYNTHESIZE',
            permissions: [],
            resultSchema: 'AdversarialCriticReport',
            acceptance: { verifiedCitations: true, verifiedReasoningActionMatch: true, withinDeadline: true },
          },
          hmacSignature: 'sig',
        },
      })

      const { synthesis, span } = await council.deliberate(blackboard, mockProvider, ledger)
      expect(synthesis.consensusReached).toBe(true)
      expect(synthesis.consensusBias).toBe('BULLISH')
      expect(synthesis.consensusOptionAction).toBe('BUY_CE')
      expect(span.summary).toContain('Deliberation Fast-Path')
    })

    it('runs active deliberation and enforces NO_TRADE when council finds irreconcilable contradiction', async () => {
      const council = new DialecticCouncilAgent()
      const ledger = new AtomicBudgetLedger(10000)
      const mockProvider: LLMProvider = {
        name: 'mock',
        chat: async () =>
          JSON.stringify({
            consensusReached: true,
            consensusBias: 'NO_TRADE',
            consensusOptionAction: 'NONE',
            confidence: 90,
            resolutionRationale:
              'Council deliberation concludes that buying calls directly into a 1.2 crore CE resistance wall during low VIX offers negative risk-reward.',
            executionDirectives: {
              mandatoryConditions: ['Wait for resistance absorption and spot momentum > 120 pts/hr'],
            },
            speeches: [
              {
                agentName: 'Options Specialist',
                role: 'COUNTER_ARGUMENT',
                thesis: '24700 CE has heavy institutional writing wall with 1.2 crore OI added.',
                citedEvidence: ['Resistance Wall at 24700'],
                recommendedAction: 'NO_TRADE',
              },
              {
                agentName: 'Council Moderator',
                role: 'SYNTHESIS',
                thesis: 'Risk of theta decay and absorption failure is asymmetric. Capital preservation mandated.',
                citedEvidence: ['VIX 13.5 (low momentum)'],
                recommendedAction: 'NO_TRADE',
              },
            ],
          }),
      }

      const blackboard = buildMockBlackboard({
        conflictMatrix: {
          unanimousDirection: 'NONE',
          hasDirectConflict: true,
          conflicts: ['Structure indicates Bullish Breakout but Options indicates Bearish Resistance Wall'],
          missingPerspectives: [],
          weightedBullishScore: 60,
          weightedBearishScore: 65,
          highestConvictionAgent: 'OptionsSpecialist',
        },
        criticEnvelope: {
          messageId: 'msg_critic_2',
          correlationId: 'mas_test_2',
          sender: 'AdversarialCriticAgent',
          recipient: 'TradingBlackboard',
          claimVersion: 1,
          timestampMs: Date.now(),
          deadlineRemainingMs: 20000,
          lifecycleState: 'succeeded',
          handoff: {
            claim: {
              verdict: 'CHALLENGE_REDUCE_SIZE',
              preMortemFailureScenario: 'Call absorption fails at 24700 wall.',
              counterEvidence: ['Heavy CE OI addition'],
              flowContradictionDetected: true,
              recommendedConfidenceAdjustment: -20,
              mandatoryConditions: [],
              reason: 'Resistance wall opposition',
            },
            provenance: { sourceAgent: 'AdversarialCriticAgent', citedFields: [], toolCallsUsed: [] },
            uncertainty: [],
            action: 'CRITIQUE',
            permissions: [],
            resultSchema: 'AdversarialCriticReport',
            acceptance: { verifiedCitations: true, verifiedReasoningActionMatch: true, withinDeadline: true },
          },
          hmacSignature: 'sig',
        },
      })

      const { synthesis, span } = await council.deliberate(blackboard, mockProvider, ledger)
      expect(synthesis.consensusBias).toBe('NO_TRADE')
      expect(synthesis.consensusOptionAction).toBe('NONE')
      expect(synthesis.speeches.length).toBe(2)
      expect(span.status).toBe('vetoed')
    })
  })

  describe('Pillar 3: Position Guardian Continuous Thesis Invalidation', () => {
    it('applies VWAP breakdown breakeven lock when trade had favorable excursion but breaks 5m VWAP', async () => {
      const guardian = new PositionGuardianAgent()
      const mockProvider: LLMProvider = {
        name: 'mock',
        chat: async () =>
          JSON.stringify({
            decision: 'HOLD', // LLM wanted to passively hold
            newIndexStopLoss: null,
            riskRewardRatio: 1.2,
            trailingStyle: 'LOOSE',
            cleanSlateCounterfactual: 'HOLD_ONLY',
            confidence: 65,
            reason: 'Holding position.',
          }),
      }

      // NAUKRI failure mode simulation: Entered at 1163, gained to 1169 (+1.0%), but now trading at 1161 (lost VWAP 1164)
      const input = {
        openPosition: {
          symbol: 'NAUKRI',
          side: 'BUY',
          entryPrice: 1163,
          currentPrice: 1161, // < VWAP
          timestamp: new Date(Date.now() - 25 * 60 * 1000).toISOString(), // 25 mins active (past incubation)
          t1Hit: true, // reached profit cushion earlier
        },
        marketData: {
          symbol: 'NAUKRI',
          price: 1161,
          vwap: 1164, // Lost VWAP
          rsi: 44,
          trend: 'bearish',
        },
      }

      const report = await guardian.evaluateOpenPosition(input, 'SCALPER', mockProvider, 'No memory')
      // Guardian should override the passive HOLD to UPDATE_SL to protect capital
      expect(report.decision).toBe('UPDATE_SL')
    })
  })
})
