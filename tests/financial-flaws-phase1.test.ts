import { describe, it, expect } from 'vitest'
import { GTITracker } from '../src/indicators/gti-tracker.js'
import { detectWaveStructure } from '../src/indicators/waves.js'
import { calculateORB } from '../src/indicators/orb.js'
import { calculateRSI } from '../src/indicators/rsi.js'
import { analyzeOptions, oiTracker } from '../src/analysis/kite-options.js'
import { validateRegime } from '../src/ai/regime-validator.js'
import { TradeAnalysisService } from '../src/analysis/trade.js'
import { getExpiryRiskProfile, isRetractGuardTriggered } from '../src/execution/expiry-risk-profile.js'
import { sanitizeAiDecision } from '../src/ai/llm.js'
import { ORCHESTRATOR_PROMPT, SCALPER_RULES, CONSENSUS_AGENT_PROMPT } from '../src/ai/prompts.js'
import type { Candle, SwingPoint } from '../src/types/analysis.js'
import type { AISuccessResponse } from '../src/ai/types.js'

describe('Phase 1: Quantitative, Indicator, Options Flow & Setup Rule Fixes (F1-F9, H1-H8)', () => {
  describe('F1: Setup-Scoped Pre-Flight Gates & Reversal Score Enforcement in TradeAnalysisService', () => {
    const service = new TradeAnalysisService()

    it('allows BUY_CE when |vwapZScore| > 2.0 during TREND / TRUE_BREAKOUT (Wave 3 launch)', () => {
      const decision: any = {
        decision: 'BUY',
        optionAction: 'BUY_CE',
        setup: 'TRUE_BREAKOUT',
        confidence: 85,
        strike: 24000,
        reason: 'Wave 3 breakout above ORB',
      }
      const tf15m = {
        vwapZScore: 2.45,
        waveContext: { currentPhase: 'WAVE_3' },
      }
      const gtiScore = { composite: 0.45, classification: 'BULLISH_ACCUMULATION', confidence: 80 }

      ;(service as any).processAiDecisionFilters(decision, tf15m, gtiScore, 'TREND', { bullish: 2, bearish: 1 })
      expect(decision.optionAction).toBe('BUY_CE')
      expect(decision.decision).toBe('BUY')
    })

    it('blocks BUY_CE when vwapZScore > 2.0 for SCALPER in non-breakout mean-reversion setup', () => {
      const decision: any = {
        decision: 'BUY',
        optionAction: 'BUY_CE',
        setup: 'TREND_CONTINUATION',
        confidence: 80,
        strike: 24000,
        reason: 'Buying top of range',
      }
      const tf15m = {
        vwapZScore: 2.35,
        waveContext: { currentPhase: 'CONSOLIDATION' },
      }
      const gtiScore = { composite: 0.1, classification: 'NEUTRAL', confidence: 60 }

      ;(service as any).processAiDecisionFilters(decision, tf15m, gtiScore, 'SCALPER', { bullish: 2, bearish: 1 })
      expect(decision.optionAction).toBe('NONE')
      expect(decision.decision).toBe('HOLD')
      expect(decision.reason).toContain('[VWAP Z-SCORE BLOCKED]')
    })

    it('deterministically blocks Playbook B (INSTITUTIONAL_TRAP) when Reversal Quality Score < 3/5', () => {
      const decision: any = {
        decision: 'BUY',
        optionAction: 'BUY_PE',
        setup: 'INSTITUTIONAL_TRAP',
        confidence: 82,
        strike: 24000,
        reason: 'Trap reversal short',
      }
      const tf15m = {
        vwapZScore: 1.1,
        waveContext: { currentPhase: 'WAVE_2' },
      }
      const gtiScore = { composite: -0.4, classification: 'BEARISH_DISTRIBUTION', confidence: 75 }

      ;(service as any).processAiDecisionFilters(decision, tf15m, gtiScore, 'SCALPER', { bullish: 4, bearish: 2 })
      expect(decision.optionAction).toBe('NONE')
      expect(decision.decision).toBe('HOLD')
      expect(decision.reason).toContain('[REVERSAL SCORE BLOCKED]')
    })
  })

  describe('F2: Real GTI Tracker Computation & Directional VWAP Deviation', () => {
    it('computes non-zero composite score and directional vwapDeviation from candles and flow', () => {
      const tracker = new GTITracker()
      const candles: Candle[] = Array.from({ length: 12 }, (_, i) => ({
        open: 24000 + i * 10,
        high: 24015 + i * 10,
        low: 23998 + i * 10,
        close: 24012 + i * 10,
        volume: i === 11 ? 300000 : 100000,
        time: Date.now() - (12 - i) * 900000,
      }))

      const score = tracker.computeFromCandles(256265, candles, 24040, 25, {
        sentiment: 'bullish',
        marketFlow: 'SHORT_COVERING',
        pcr: 1.35,
      })

      expect(score.confidence).toBeGreaterThan(50)
      expect(score.composite).toBeGreaterThan(0.3)
      expect(score.components.vwapDeviation).toBeGreaterThan(0)
      expect(score.components.oiSignal).toBeGreaterThan(0.5)
      expect(score.classification).toContain('BULLISH')
    })
  })

  describe('F3: Options Flow Polarity & SHORT_COVERING Detection in kite-options.ts', () => {
    it('correctly detects SHORT_COVERING when Call OI drops and Call LTP rises', () => {
      ;(oiTracker as any).snapshots = []
      const instruments = [
        { instrument_type: 'CE' as const, strike: 24000, tradingsymbol: 'NIFTY24000CE', instrument_token: 101 },
        { instrument_type: 'PE' as const, strike: 24000, tradingsymbol: 'NIFTY24000PE', instrument_token: 102 },
      ]

      // Seed snapshot 6 minutes ago
      ;(oiTracker as any).snapshots = [
        {
          timestamp: Date.now() - 6 * 60 * 1000,
          data: new Map([
            ['NFO:NIFTY24000CE', { oi: 150000, ltp: 100 }],
            ['NFO:NIFTY24000PE', { oi: 100000, ltp: 100 }],
          ]),
        },
      ]

      // Current quotes: CE OI dropped by 40,000 while CE price surged to 130 (Call Short Covering)
      const currentQuotes = {
        'NFO:NIFTY24000CE': { oi: 110000, last_price: 130, volume: 500000 },
        'NFO:NIFTY24000PE': { oi: 105000, last_price: 80, volume: 400000 },
      }

      const analysis = analyzeOptions(currentQuotes, instruments, 24020, undefined, 5)
      expect(analysis.marketFlow).toBe('SHORT_COVERING')
    })

    it('correctly classifies Put Long Buildup during an index drop as bearish SHORT_BUILDUP on the underlying', () => {
      ;(oiTracker as any).snapshots = [
        {
          timestamp: Date.now() - 6 * 60 * 1000,
          data: new Map([
            ['NFO:NIFTY24000CE', { oi: 100000, ltp: 100 }],
            ['NFO:NIFTY24000PE', { oi: 100000, ltp: 100 }],
          ]),
        },
      ]

      const instruments = [
        { instrument_type: 'CE' as const, strike: 24000, tradingsymbol: 'NIFTY24000CE', instrument_token: 101 },
        { instrument_type: 'PE' as const, strike: 24000, tradingsymbol: 'NIFTY24000PE', instrument_token: 102 },
      ]

      // PE OI surges +60,000 and PE LTP surges 100 -> 145 (Put Long Buildup = Bearish on NIFTY)
      const currentQuotes = {
        'NFO:NIFTY24000CE': { oi: 100000, last_price: 75, volume: 200000 },
        'NFO:NIFTY24000PE': { oi: 160000, last_price: 145, volume: 600000 },
      }

      const analysis = analyzeOptions(currentQuotes, instruments, 23940, undefined, 5)
      expect(analysis.marketFlow).toBe('SHORT_BUILDUP')
    })
  })

  describe('F4: Elliott Wave 5 Target & Higher-Low Pullback Polarity in waves.ts', () => {
    it('projects bullish wave5Target above wave1High (lastHigh + 0.618 * fibRange) and keeps bullish polarity on Higher Low pullback', () => {
      const swings: SwingPoint[] = [
        { type: 'LOW', price: 23800, time: 1000 },
        { type: 'HIGH', price: 23950, time: 2000 },
        { type: 'LOW', price: 23900, time: 3000 },
        { type: 'HIGH', price: 24100, time: 4000 },
        { type: 'LOW', price: 24010, time: 5000 }, // Higher Low pullback after Higher High
      ]

      const wave = detectWaveStructure(swings, 24045)
      expect(wave.wave1High).toBe(24100)
      expect(wave.wave1Low).toBe(24010)
      // fibRange = 90 -> wave5Target = 24100 + 90 * 0.618 = 24155.62 (> wave1High)
      expect(wave.wave5Target).toBeCloseTo(24155.62, 2)
      expect(wave.wave5Target!).toBeGreaterThan(wave.wave1High!)
    })
  })

  describe('F5: Same-Day IST Opening Range (ORB) & Wilder RMA RSI', () => {
    it('filters calculateORB strictly to the latest IST trading day and excludes 09:45 candle', () => {
      const priorDay915 = new Date('2026-10-29T09:15:00+05:30').getTime()
      const currentDay915 = new Date('2026-10-30T09:15:00+05:30').getTime()
      const currentDay930 = new Date('2026-10-30T09:30:00+05:30').getTime()
      const currentDay945 = new Date('2026-10-30T09:45:00+05:30').getTime()

      const candles: Candle[] = [
        // Prior day had extreme highs/lows that must NOT pollute today's ORB
        { open: 25000, high: 25500, low: 23000, close: 24200, volume: 1000, time: priorDay915 },
        // Today's 09:15 and 09:30 bars form the 09:15-09:45 ORB
        { open: 24100, high: 24150, low: 24080, close: 24120, volume: 1000, time: currentDay915 },
        { open: 24120, high: 24180, low: 24090, close: 24160, volume: 1000, time: currentDay930 },
        // Today's 09:45 bar (09:45-10:00) breaks above 24180 and must NOT be part of the ORB boundary itself
        { open: 24160, high: 24240, low: 24155, close: 24220, volume: 1500, time: currentDay945 },
      ]

      const orb = calculateORB(candles)
      expect(orb).not.toBeNull()
      expect(orb!.high).toBe(24180)
      expect(orb!.low).toBe(24080)
      expect(orb!.broken).toBe('UP')
    })

    it('computes Wilder RMA RSI over full candle history', () => {
      const candles: Candle[] = Array.from({ length: 30 }, (_, i) => ({
        open: 24000 + i * 5,
        high: 24010 + i * 5,
        low: 23995 + i * 5,
        close: 24000 + i * 5 + (i % 3 === 0 ? -4 : 8),
        volume: 1000,
        time: 1000 * i,
      }))
      const rsi = calculateRSI(candles, 14)
      expect(rsi).toBeGreaterThan(50)
      expect(rsi).toBeLessThan(100)
    })
  })

  describe('F6: Deterministic RegimeValidator Checks (Trend Alignment, ADX, RSI, Dead-Zone, Corrective Wave)', () => {
    it('overrides TREND to SCALPER when 15m and 1h trends conflict or during 11:30-13:00 dead zone outside Wave 3', () => {
      const result = validateRegime(
        { activeAgent: 'TREND', confidence: 85, rationale: 'Test' },
        {
          vix: { current: 14.5 },
          time: '12:15:00',
          tf1h: { trend: 'bearish' },
          tf15m: {
            trend: 'bullish',
            rsi: 78,
            adx: { adx: 16, plusDI: 20, minusDI: 18 },
            waveContext: { currentPhase: 'ABC_CORRECTION' },
          },
        }
      )

      expect(result.wasOverridden).toBe(true)
      expect(result.activeAgent).toBe('SCALPER')
      expect(result.checks.filter((c) => !c.passed).length).toBeGreaterThanOrEqual(4)
    })
  })

  describe('F7: Variant D_Refined Retract Guard (RETRACT_EPSILON & NEAR_DTE Early-Zone Conjunction)', () => {
    it('prevents premature NEAR_DTE exit in [12%, 20%) peak gain zone when dropFromPeakPct < 12%', () => {
      const nearDte = getExpiryRiskProfile(2)
      // Entry 100, Peak 115 (+15% gain, inside [12%, 20%) zone). Price dips to 109 (5.2% drop < 12%, lostGainRatio = 6/15 = 40% >= 35%)
      expect(isRetractGuardTriggered(100, 115, 109, nearDte)).toBe(false)
      // If price drops >= 12% from peak (e.g. 101 -> 12.17% drop AND 93% lost gain), it triggers
      expect(isRetractGuardTriggered(100, 115, 101, nearDte)).toBe(true)
    })
  })

  describe('F8 & H1-H8: sanitizeAiDecision Normalization & Prompt Hygiene', () => {
    it('normalizes decision: "SELL" with optionAction: "BUY_PE" to decision: "BUY" and sanitizes all targets', () => {
      const raw: AISuccessResponse = {
        decision: 'SELL' as any,
        optionAction: 'BUY_PE',
        confidence: 85,
        entry: 24000,
        stopLoss: 120, // Hallucinated option premium instead of index stop
        targets: [24200, 23850], // First target is inverted (> 24000), second is valid (< 24000)
        setup: 'TRUE_BREAKOUT',
        macroTrend: 'BEARISH',
        instrument: 'OPTIONS',
        strike: 24000,
        riskRewardRatio: 1.5,
        reason: 'Bearish breakdown',
      }

      const sanitized = sanitizeAiDecision(raw, { price: 24000 }, 'SCALPER')
      expect(sanitized.decision).toBe('BUY')
      expect(sanitized.stopLoss).toBeCloseTo(24000 * 1.005, 2)
      expect(sanitized.targets).toEqual([23850])
    })

    it('verifies prompts do not reference non-existent heavyweight components or undefined strike fields', () => {
      expect(ORCHESTRATOR_PROMPT).not.toContain('top 3 heavyweights')
      expect(SCALPER_RULES).not.toContain('20/50 EMA (30m)')
      expect(CONSENSUS_AGENT_PROMPT).toContain('recommendedBuyStrikeCE')
      expect(CONSENSUS_AGENT_PROMPT).toContain('recommendedBuyStrikePE')
    })
  })
})
