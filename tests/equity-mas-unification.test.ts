import { describe, it, expect, vi } from 'vitest'
import { BlackboardContextScoper } from '../src/ai/mas/blackboard.js'
import { OptionsFlowAgent, ConsensusJudgeAgent, TradingMASOrchestrator } from '../src/ai/mas/agents.js'
import { MessageBusValidator, MultiLevelVerifier, RunDeadline, AtomicBudgetLedger } from '../src/ai/mas/contracts.js'
import { TradePlanMathValidator } from '../src/ai/mas/tools.js'
import type { TradingBlackboard, StructureBlackboardSlice } from '../src/ai/mas/types.js'
import type { LLMProvider } from '../src/ai/types.js'
import { EquityAnalysisService } from '../src/analysis/equity-analysis.js'

describe('Unified MAS Architecture across Equities & Options', () => {
  const scoper = new BlackboardContextScoper()
  const bus = new MessageBusValidator()
  const verifier = new MultiLevelVerifier()
  const deadline = new RunDeadline(25000)
  const ledger = new AtomicBudgetLedger(48000)

  describe('1. Deterministic Equity Pre-Flight Gates', () => {
    it('blocks shorting (BUY_PE / SELL_EQUITY) when benchmark NIFTY is Bullish', () => {
      const input = {
        symbol: 'SBICARD',
        assetClass: 'EQUITY',
        isFnoListed: true,
        tf15m: { price: 800, vwap: 810, vwapZScore: -1.0, rsi: 45 },
        tf5m: { price: 800, rsi: 45 },
        benchmark: { trend15m: 'BULLISH', rsi15m: 55, relativeStrength: -1.2 },
      }

      const gates = scoper.computePreFlightGates(input, 'SCALPER')
      expect(gates.isBlocked).toBe(false) // allowedActions might allow CE, but PE is blocked
      expect(gates.scalperAllowedActions).not.toContain('BUY_PE')
      expect(gates.blockReasons.some((r) => r.includes('Benchmark index (NIFTY) is BULLISH'))).toBe(true)
    })

    it('blocks longing (BUY_CE / BUY_EQUITY) when benchmark NIFTY is Bearish', () => {
      const input = {
        symbol: 'BANKBARODA',
        assetClass: 'EQUITY',
        isFnoListed: true,
        tf15m: { price: 240, vwap: 238, vwapZScore: 0.8, rsi: 52 },
        tf5m: { price: 240, rsi: 52 },
        benchmark: { trend15m: 'BEARISH', rsi15m: 40, relativeStrength: 1.5 },
      }

      const gates = scoper.computePreFlightGates(input, 'SCALPER')
      expect(gates.scalperAllowedActions).not.toContain('BUY_CE')
      expect(gates.blockReasons.some((r) => r.includes('Benchmark index (NIFTY) is BEARISH'))).toBe(true)
    })

    it('blocks shorting when stock 15m RSI < 35 (downside exhaustion protection)', () => {
      const input = {
        symbol: 'SBICARD',
        assetClass: 'EQUITY',
        isFnoListed: true,
        tf15m: { price: 800, vwap: 810, vwapZScore: -1.2, rsi: 33.5 }, // RSI < 35
        tf5m: { price: 800, rsi: 35 },
        benchmark: { trend15m: 'SIDEWAYS', rsi15m: 48, relativeStrength: -0.5 },
      }

      const gates = scoper.computePreFlightGates(input, 'SCALPER')
      expect(gates.scalperAllowedActions).not.toContain('BUY_PE')
      expect(gates.blockReasons.some((r) => r.includes('RSI (33.5) < 35: downward momentum exhausted'))).toBe(true)
    })

    it('blocks longing when stock 15m RSI > 65 (overbought extension protection)', () => {
      const input = {
        symbol: 'BANKBARODA',
        assetClass: 'EQUITY',
        isFnoListed: true,
        tf15m: { price: 250, vwap: 245, vwapZScore: 1.5, rsi: 68.2 }, // RSI > 65
        tf5m: { price: 250, rsi: 70 },
        benchmark: { trend15m: 'SIDEWAYS', rsi15m: 50, relativeStrength: 0.8 },
      }

      const gates = scoper.computePreFlightGates(input, 'SCALPER')
      expect(gates.scalperAllowedActions).not.toContain('BUY_CE')
      expect(gates.blockReasons.some((r) => r.includes('RSI (68.2) > 65: upward momentum overextended'))).toBe(true)
    })
  })

  describe('2. Specialist Multi-Asset Adaptations', () => {
    it('OptionsFlowAgent fast-paths neutral envelope for pure cash equities without calling LLM', async () => {
      const agent = new OptionsFlowAgent()
      const mockBlackboard: any = {
        runId: 'mas_test_equity_1',
        claimVersion: 1,
        structureSlice: { assetClass: 'EQUITY', isFnoListed: false },
        optionsSlice: { focusedRows: [] },
      }

      const mockProvider: LLMProvider = {
        name: 'mock',
        chat: vi.fn(),
      }

      const { envelope, span } = await agent.analyze(mockBlackboard, mockProvider, bus, verifier, deadline, ledger)
      expect(mockProvider.chat).not.toHaveBeenCalled()
      expect(envelope.handoff.claim.dominantFlow).toBe('EQUITY_CASH_ONLY')
      expect(envelope.handoff.claim.recommendedOptionAction).toBe('NONE')
      expect(envelope.handoff.claim.confidence).toBe(75)
      expect(span.summary).toContain('EQUITY_CASH_ONLY')
    })

    it('ConsensusJudgeAgent correctly formats Cash Equity BUY_EQUITY decisions', async () => {
      const judge = new ConsensusJudgeAgent()
      const mockBlackboard: any = {
        runId: 'mas_test_equity_2',
        claimVersion: 1,
        structureSlice: { assetClass: 'EQUITY', tf15m: { price: 500, trend: 'BULLISH' } },
        optionsSlice: { atmStrike: 500 },
        deliberationCouncil: null,
        conflictMatrix: { hasDirectConflict: false, missingPerspectives: [] },
        preFlightGates: { isBlocked: false },
      }

      const mockProvider: LLMProvider = {
        name: 'mock',
        chat: vi.fn().mockResolvedValue(
          JSON.stringify({
            decision: 'BUY',
            setup: 'TRUE_BREAKOUT',
            macroTrend: 'BULLISH',
            instrument: 'EQUITY',
            optionAction: 'BUY_EQUITY',
            confidence: 85,
            entry: 500,
            stopLoss: 495,
            targets: [510, 520],
            riskRewardRatio: 2.0,
            reason: 'Clean breakout above VWAP with relative strength.',
          })
        ),
      }

      const { decision } = await judge.synthesize(mockBlackboard, mockProvider, ledger)
      expect(decision.decision).toBe('BUY')
      expect(decision.instrument).toBe('EQUITY')
      expect(decision.optionAction).toBe('BUY_EQUITY')
      expect(decision.action).toBe('BUY')
      expect(decision.confidence).toBe(85)
      expect(decision.strike).toBeNull()
    })
  })

  describe('3. Minimum 75% Confidence Cutoff & Math Validator', () => {
    it('TradePlanMathValidator rejects trade plan when confidence < 75% via Gate 1 hard veto', () => {
      const validator = new TradePlanMathValidator()
      const candidate: any = {
        decision: 'BUY',
        optionAction: 'BUY_CE',
        setup: 'TRUE_BREAKOUT',
        confidence: 70, // Below 75%
        entry: 24000,
        stopLoss: 23900,
        targets: [24200],
        riskRewardRatio: 2.0,
      }
      const gates: any = {
        isBlocked: false,
        trendAllowedActions: ['BUY_CE', 'NONE'],
        scalperAllowedActions: ['BUY_CE', 'NONE'],
        trapAllowedActions: ['BUY_CE', 'NONE'],
      }

      const result = validator.validateCandidatePlan(candidate, 24000, 'SCALPER', 'intraday', gates, 'APPROVE')
      expect(result.valid).toBe(false)
      expect(result.isHardRiskVeto).toBe(true)
      expect(result.errors.some((e) => e.includes('Decision confidence (70%) is below minimum execution threshold (75%)'))).toBe(true)
    })

    it('TradePlanMathValidator accepts clean cash equity trade with BUY_EQUITY', () => {
      const validator = new TradePlanMathValidator()
      const candidate: any = {
        decision: 'BUY',
        instrument: 'EQUITY',
        optionAction: 'BUY_EQUITY',
        setup: 'TRUE_BREAKOUT',
        confidence: 82,
        entry: 500,
        stopLoss: 495,
        targets: [510],
        riskRewardRatio: 2.0,
      }
      const gates: any = {
        isBlocked: false,
        trendAllowedActions: ['BUY_CE', 'NONE'],
        scalperAllowedActions: ['BUY_CE', 'NONE'],
        trapAllowedActions: ['BUY_CE', 'NONE'],
      }

      const result = validator.validateCandidatePlan(candidate, 500, 'SCALPER', 'intraday', gates, 'APPROVE')
      expect(result.valid).toBe(true)
      expect(result.isHardRiskVeto).toBe(false)
      expect(result.errors).toHaveLength(0)
    })
  })

  describe('4. Silent Option-to-Equity Rerouting Protection', () => {
    it('EquityAnalysisService prohibits silent conversion of Put Options into naked cash shorts', async () => {
      const service = new EquityAnalysisService()
      const decision: any = {
        symbol: 'SBICARD',
        decision: 'SELL',
        action: 'BUY_PE',
        strike: 800,
        holdingMode: 'MIS',
        confidence: 85,
        reason: 'Bearish put candidate',
      }

      // Invoke private applyCashEquityFallback via any (returns new immutable decision)
      const fallback = (service as any).applyCashEquityFallback(decision)

      expect(fallback.decision).toBe('NO_TRADE')
      expect(fallback.action).toBe('NONE')
      expect(fallback.reason).toContain('silent cash short conversion prohibited')
    })
  })
})
