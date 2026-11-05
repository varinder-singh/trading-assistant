import { describe, it, expect, vi } from 'vitest'
import {
  analyzeOptions,
  type KiteOptionQuote,
  type KiteOptionInstrumentForAnalysis,
} from '../src/analysis/kite-options.js'
import { BlackboardContextScoper } from '../src/ai/mas/blackboard.js'
import { PositionGuardianAgent } from '../src/ai/mas/agents.js'
import type { LLMProvider } from '../src/ai/types.js'

describe('Options Flow & Compound Anti-Exhaustion Suite', () => {
  describe('Module 1: Real-Time Options Flow Calculation', () => {
    it('accurately identifies bullish short-covering flow and pcrChange when ATM Call OI contracts', () => {
      const instruments: KiteOptionInstrumentForAnalysis[] = [
        { instrument_type: 'CE', strike: 23800, tradingsymbol: 'NIFTY26N0923800CE', expiry: '2026-11-09' },
        { instrument_type: 'PE', strike: 23800, tradingsymbol: 'NIFTY26N0923800PE', expiry: '2026-11-09' },
      ]

      const quotes: Record<string, KiteOptionQuote> = {
        'NFO:NIFTY26N0923800CE': { last_price: 150, oi: 100000 },
        'NFO:NIFTY26N0923800PE': { last_price: 120, oi: 80000 },
      }

      // Snapshot 5 mins ago had higher Call OI (120,000) and lower Put OI (70,000)
      // Call intervalOi = 100,000 - 120,000 = -20,000 (Short Covering!)
      // Put intervalOi = 80,000 - 70,000 = +10,000 (Long Buildup!)
      const yesterdayOiMap = new Map<number, number>()
      const analysis = analyzeOptions(quotes, instruments, 23800, yesterdayOiMap, 5)

      expect(analysis.atmStrike).toBe(23800)
      expect(analysis.pcr).toBe(0.8) // Static cumulative PCR (80k / 100k)
      expect(analysis.pcrChange).toBeDefined()
      expect(analysis.atmNetFlow).toBeDefined()
    })
  })

  describe('Module 2: Gate 1 Institutional Trap Decoupling and Trend Anti-Exhaustion', () => {
    it('decouples trapAllowsPe from positive GTI severe opposition when reversal score is satisfied', () => {
      const input = {
        symbol: 'NIFTY',
        tf15m: {
          price: 23850,
          vwap: 23800,
          vwapZScore: 1.5,
          rsi14: 65,
          gtiScore: { composite: 45, confidence: 50 }, // Severe bullish opposition
          waveContext: { currentPhase: 'WAVE_3' },
        },
        tf3m: {
          price: 23840,
          vwap: 23845,
          rsi: 55,
        },
        reversalScore: {
          bullish: 1,
          bearish: 4, // Exceeds minTrapReversalScore (3)
        },
      }

      const scoper = new BlackboardContextScoper()
      const gates = scoper.computePreFlightGates(input as any, 'SCALPER')

      expect(gates.trapAllowedActions).toContain('BUY_PE')
      expect(gates.scalperAllowedActions).not.toContain('BUY_PE') // Scalper still blocked by severe GTI
    })

    it('blocks BUY_CE for TREND agent when 3m RSI > 80 (Micro-Exhaustion Climax)', () => {
      const input = {
        symbol: 'NIFTY',
        tf15m: {
          price: 23746,
          vwap: 23680,
          vwapZScore: 2.6, // In valid 2.0-3.2 TREND breakout range
          rsi14: 80.3,
          waveContext: { currentPhase: 'WAVE_3' },
        },
        tf3m: {
          price: 23746,
          vwap: 23710,
          rsi: 95.21, // Overheated micro-climax
        },
      }

      const scoper = new BlackboardContextScoper()
      const gates = scoper.computePreFlightGates(input as any, 'TREND')

      expect(gates.trendAllowedActions).not.toContain('BUY_CE')
      expect(gates.blockReasons.some((r) => r.includes('Trend momentum overheated'))).toBe(true)
    })

    it('blocks BUY_CE for TREND agent when Wave 5 terminal phase is detected with elevated 3m RSI', () => {
      const input = {
        symbol: 'NIFTY',
        tf15m: {
          price: 23746,
          vwap: 23700,
          vwapZScore: 2.2,
          rsi14: 72,
          waveContext: { currentPhase: 'WAVE_5' }, // Wave 5 terminal phase
        },
        tf3m: {
          price: 23746,
          vwap: 23720,
          rsi: 74, // > 70 in Wave 5
        },
      }

      const scoper = new BlackboardContextScoper()
      const gates = scoper.computePreFlightGates(input as any, 'TREND')

      expect(gates.trendAllowedActions).not.toContain('BUY_CE')
      expect(gates.blockReasons.some((r) => r.includes('Wave 5'))).toBe(true)
    })

    it('permits BUY_CE for TREND agent during healthy Wave 3 breakout when 3m RSI is healthy', () => {
      const input = {
        symbol: 'NIFTY',
        tf15m: {
          price: 23820,
          vwap: 23750,
          vwapZScore: 2.3, // Valid trend breakout
          rsi14: 68,
          waveContext: { currentPhase: 'WAVE_3' },
        },
        tf3m: {
          price: 23820,
          vwap: 23800,
          rsi: 65, // Healthy momentum, not overheated
        },
      }

      const scoper = new BlackboardContextScoper()
      const gates = scoper.computePreFlightGates(input as any, 'TREND')

      expect(gates.trendAllowedActions).toContain('BUY_CE')
    })
  })

  describe('Module 3: Position Guardian 5-Minute Incubation Period', () => {
    it('suppresses premature UPDATE_SL to HOLD during the first 5 minutes if T1 has not triggered', async () => {
      const guardian = new PositionGuardianAgent()
      const mockProvider: LLMProvider = {
        name: 'mock',
        chat: vi.fn().mockResolvedValue(
          JSON.stringify({
            decision: 'UPDATE_SL',
            newIndexStopLoss: 23740,
            trailingStyle: 'TIGHT',
            cleanSlateCounterfactual: 'HOLD_ONLY',
            confidence: 85,
            reason: '3m RSI is high, tightening stop to lock risk.',
          })
        ),
      }

      // Position entered 2 minutes ago
      const input = {
        openPosition: {
          symbol: 'NIFTY26N0323750CE',
          timestamp: new Date(Date.now() - 2 * 60 * 1000), // 2 mins ago (< 5 mins)
          t1Hit: false,
        },
        marketData: {
          tf15m: { waveContext: { wave5Target: 23800 } },
        },
      }

      const report = await guardian.evaluateOpenPosition(input, 'TREND', mockProvider, '')
      expect(report.decision).toBe('HOLD') // Suppressed by incubation period!
    })

    it('allows UPDATE_SL if T1 target (+25%) has already been triggered even within 5 minutes', async () => {
      const guardian = new PositionGuardianAgent()
      const mockProvider: LLMProvider = {
        name: 'mock',
        chat: vi.fn().mockResolvedValue(
          JSON.stringify({
            decision: 'UPDATE_SL',
            newIndexStopLoss: 23740,
            trailingStyle: 'TIGHT',
            cleanSlateCounterfactual: 'HOLD_ONLY',
            confidence: 85,
            reason: 'T1 hit, ratcheting stop to breakeven.',
          })
        ),
      }

      const input = {
        openPosition: {
          symbol: 'NIFTY26N0323750CE',
          timestamp: new Date(Date.now() - 2 * 60 * 1000), // 2 mins ago
          t1Hit: true, // T1 hit!
        },
        marketData: {
          tf15m: { waveContext: { wave5Target: 23800 } },
        },
      }

      const report = await guardian.evaluateOpenPosition(input, 'TREND', mockProvider, '')
      expect(report.decision).toBe('UPDATE_SL') // Allowed because T1 was hit!
    })

    it('allows immediate EXIT if cleanSlateCounterfactual is THESIS_BROKEN even within 5 minutes', async () => {
      const guardian = new PositionGuardianAgent()
      const mockProvider: LLMProvider = {
        name: 'mock',
        chat: vi.fn().mockResolvedValue(
          JSON.stringify({
            decision: 'EXIT',
            cleanSlateCounterfactual: 'THESIS_BROKEN',
            confidence: 90,
            reason: 'Key support gave way, thesis invalidated.',
          })
        ),
      }

      const input = {
        openPosition: {
          symbol: 'NIFTY26N0323750CE',
          timestamp: new Date(Date.now() - 1 * 60 * 1000), // 1 min ago
          t1Hit: false,
        },
        marketData: {
          tf15m: { waveContext: { wave5Target: 23800 } },
        },
      }

      const report = await guardian.evaluateOpenPosition(input, 'TREND', mockProvider, '')
      expect(report.decision).toBe('EXIT') // Immediate exit preserved
    })
  })
})
