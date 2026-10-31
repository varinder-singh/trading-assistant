import { describe, it, expect } from 'vitest'
import { sanitizeAiDecision } from '../src/ai/llm.js'
import type { AISuccessResponse } from '../src/ai/types.js'
import {
  calculateBaseSignalPrice,
  calculateBoundedRiskAndTarget,
  isEntrySpikeTriggered,
} from '../src/execution/session-manager.js'

describe('Fix 2: LLM Decision Sanitization & Session ATR Risk Bounding', () => {
  it('should override non-index stop-loss (e.g. 109.8 on Oct 19 Trade #2) with safe structural index stop', () => {
    const rawDecision: AISuccessResponse = {
      decision: 'BUY',
      confidence: 85,
      optionAction: 'BUY_PE',
      entry: 22850,
      stopLoss: 109.8, // Hallucinated option premium level instead of index level
      targets: [22750],
      reason: 'Bearish momentum breakdown',
      setup: 'TRUE_BREAKOUT',
      macroTrend: 'EXPANDING_BEARISH',
      instrument: 'OPTIONS',
      strike: 22900,
      riskRewardRatio: 1.5,
    }

    const sanitized = sanitizeAiDecision(rawDecision, { price: 22850 }, 'SCALPER')

    // For BUY_PE, invalid stop loss is overridden to entry * 1.005
    expect(sanitized.stopLoss).toBeCloseTo(22850 * 1.005, 2)
  })

  it('should override macro stop-loss exceeding 2.0% distance with safe index stop', () => {
    const rawDecision: AISuccessResponse = {
      decision: 'BUY',
      confidence: 80,
      optionAction: 'BUY_PE',
      entry: 22400,
      stopLoss: 22950, // 550 points away (+2.45% > 2.0% bound)
      targets: [22300],
      reason: 'Macro downtrend',
      setup: 'TRUE_BREAKOUT',
      macroTrend: 'EXPANDING_BEARISH',
      instrument: 'OPTIONS',
      strike: 22400,
      riskRewardRatio: 1.5,
    }

    const sanitized = sanitizeAiDecision(rawDecision, { price: 22400 }, 'SCALPER')

    // Distance > 2% is treated as invalid hallucination and overridden
    expect(sanitized.stopLoss).toBeCloseTo(22400 * 1.005, 2)
  })

  it('should correct inverted stop loss to the protective side of entry', () => {
    // BUY_CE inverted: stopLoss (22550) > entry (22500)
    const rawCeDecision: AISuccessResponse = {
      decision: 'BUY',
      confidence: 80,
      optionAction: 'BUY_CE',
      entry: 22500,
      stopLoss: 22550, // Wrong side for CE
      targets: [22650],
      reason: 'Bullish breakout',
      setup: 'TRUE_BREAKOUT',
      macroTrend: 'COMPRESSION_BULLISH',
      instrument: 'OPTIONS',
      strike: 22500,
      riskRewardRatio: 1.5,
    }

    const sanitizedCe = sanitizeAiDecision(rawCeDecision, { price: 22500 }, 'SCALPER')
    expect(sanitizedCe.stopLoss).toBeCloseTo(22500 * 0.995, 2)

    // BUY_PE inverted: stopLoss (22450) < entry (22500)
    const rawPeDecision: AISuccessResponse = {
      decision: 'BUY',
      confidence: 80,
      optionAction: 'BUY_PE',
      entry: 22500,
      stopLoss: 22450, // Wrong side for PE
      targets: [22350],
      reason: 'Bearish breakdown',
      setup: 'TRUE_BREAKOUT',
      macroTrend: 'EXPANDING_BEARISH',
      instrument: 'OPTIONS',
      strike: 22500,
      riskRewardRatio: 1.5,
    }

    const sanitizedPe = sanitizeAiDecision(rawPeDecision, { price: 22500 }, 'SCALPER')
    expect(sanitizedPe.stopLoss).toBeCloseTo(22500 * 1.005, 2)
  })

  it('should sanitize invalid or inverted targets', () => {
    const rawDecision: AISuccessResponse = {
      decision: 'BUY',
      confidence: 75,
      optionAction: 'BUY_CE',
      entry: 22500,
      stopLoss: 22400,
      targets: [22400], // Inverted target below entry for CE
      reason: 'Bullish continuation',
      setup: 'TREND_CONTINUATION',
      macroTrend: 'COMPRESSION_BULLISH',
      instrument: 'OPTIONS',
      strike: 22500,
      riskRewardRatio: 1.5,
    }

    const sanitized = sanitizeAiDecision(rawDecision, { price: 22500 }, 'SCALPER')
    expect(sanitized.targets).toBeDefined()
    expect(sanitized.targets![0]).toBeCloseTo(22500 * 1.005, 2)
  })

  it('should bound indexRiskPoints between 1.5*ATR14 and 2.5*ATR14 for SCALPER agent using calculateBoundedRiskAndTarget', () => {
    const atr14 = 20

    // Scenario A: Huge macro structural stop (411 index points, like Oct 22)
    const resultA = calculateBoundedRiskAndTarget({
      spotPrice: 22400,
      stopLoss: 22811,
      atr14,
      agentType: 'SCALPER',
      estimatedDelta: 0.5,
      signalPrice: 50,
    })
    expect(resultA.indexRiskPoints).toBe(50) // capped at 2.5 * 20 = 50
    expect(resultA.optionRiskPoints).toBe(25) // 50 * 0.5

    // Scenario B: Extremely tight stop (10 index points)
    const resultB = calculateBoundedRiskAndTarget({
      spotPrice: 22400,
      stopLoss: 22390,
      atr14,
      agentType: 'SCALPER',
      estimatedDelta: 0.5,
      signalPrice: 50,
    })
    expect(resultB.indexRiskPoints).toBe(30) // floored at 1.5 * 20 = 30
    expect(resultB.optionRiskPoints).toBe(15) // 30 * 0.5

    // Scenario C: Moderate stop inside ATR bounds (40 points)
    const resultC = calculateBoundedRiskAndTarget({
      spotPrice: 22400,
      stopLoss: 22440,
      atr14,
      agentType: 'SCALPER',
      estimatedDelta: 0.5,
      signalPrice: 50,
    })
    expect(resultC.indexRiskPoints).toBe(40)
    expect(resultC.optionRiskPoints).toBe(20) // 40 * 0.5

    // Scenario D: Non-index hallucinated stop (e.g. 109.8 option premium)
    const resultD = calculateBoundedRiskAndTarget({
      spotPrice: 22400,
      stopLoss: 109.8,
      atr14,
      agentType: 'SCALPER',
      estimatedDelta: 0.5,
      signalPrice: 50,
    })
    expect(resultD.indexRiskPoints).toBe(30) // Overridden to minAtrRisk
  })

  it('should bound indexRiskPoints up to 4.0*ATR14 for TREND agent using calculateBoundedRiskAndTarget', () => {
    const atr14 = 20
    const rawStructuralRisk = 120 // 120 points distance

    const result = calculateBoundedRiskAndTarget({
      spotPrice: 22400,
      stopLoss: 22520, // 120 points
      atr14,
      agentType: 'TREND',
      estimatedDelta: 0.5,
      signalPrice: 60,
    })
    expect(result.indexRiskPoints).toBe(80) // capped at 4.0 * 20 = 80
    expect(result.optionRiskPoints).toBe(40) // 80 * 0.5
  })

  it('should anchor calculatedTarget to bounded option risk and enforce DTE floor in calculateBoundedRiskAndTarget', () => {
    const signalPrice = 46.7
    const atr14 = 20
    const estimatedDelta = 0.5

    const result = calculateBoundedRiskAndTarget({
      spotPrice: 22400,
      stopLoss: 22800, // 400 pts structural stop -> capped at maxAtrRisk 50 -> optionRisk = 25
      atr14,
      agentType: 'SCALPER',
      estimatedDelta,
      signalPrice,
      riskRewardRatio: 1.5,
    })

    // Uncapped target would be 46.7 + 25 * 1.5 = 84.2, but scalper capped at 1.5 * 46.7 = 70.05
    expect(result.calculatedTarget).toBeCloseTo(70.05, 2)
    expect(result.calculatedTarget).toBeLessThan(100)

    // SL floor for SCALPER: capped at max 20% risk -> 46.7 * 0.8 = 37.36
    expect(result.calculatedSl).toBeCloseTo(37.36, 2)
  })

  it('should calculate directional index spike correctly for CE options (only upward index move increases CE)', () => {
    // Upward index surge: index moved up 25 points (22400 -> 22425)
    const baseWithCeSurge = calculateBaseSignalPrice({
      optionType: 'CE',
      preLlmOptionLtp: 40.0,
      entryPrice: 42.0,
      estimatedDelta: 0.5,
      baseIndexPrice: 22400,
      triggerIndexPrice: 22425,
    })
    // Surge offset: 0.5 * 25 = 12.5; base = 40.0 - 12.5 = 27.5
    expect(baseWithCeSurge).toBe(27.5)

    // Downward index move: index dropped 25 points (22400 -> 22375)
    // For CE, an index drop does NOT surge the option; base must not be depressed
    const baseWithCeDrop = calculateBaseSignalPrice({
      optionType: 'CE',
      preLlmOptionLtp: 40.0,
      entryPrice: 40.0,
      estimatedDelta: 0.5,
      baseIndexPrice: 22400,
      triggerIndexPrice: 22375,
    })
    expect(baseWithCeDrop).toBe(40.0)
  })

  it('should calculate directional index spike correctly for PE options (only downward index move increases PE)', () => {
    // Downward index move: index dropped 25 points (22400 -> 22375)
    const baseWithPeSurge = calculateBaseSignalPrice({
      optionType: 'PE',
      preLlmOptionLtp: 40.0,
      entryPrice: 42.0,
      estimatedDelta: 0.5,
      baseIndexPrice: 22400,
      triggerIndexPrice: 22375,
    })
    // Surge offset: 0.5 * 25 = 12.5; base = 40.0 - 12.5 = 27.5
    expect(baseWithPeSurge).toBe(27.5)

    // Upward index move: index rallied 25 points (22400 -> 22425)
    // For PE, an index rally does NOT surge the option; base must not be depressed
    const baseWithPeRally = calculateBaseSignalPrice({
      optionType: 'PE',
      preLlmOptionLtp: 40.0,
      entryPrice: 40.0,
      estimatedDelta: 0.5,
      baseIndexPrice: 22400,
      triggerIndexPrice: 22425,
    })
    expect(baseWithPeRally).toBe(40.0)
  })

  it('should fallback to entryPrice when preLlmOptionLtp is not available in calculateBaseSignalPrice', () => {
    const baseWithoutPreLtp = calculateBaseSignalPrice({
      optionType: 'CE',
      entryPrice: 45.5,
      estimatedDelta: 0.5,
      baseIndexPrice: 22400,
      triggerIndexPrice: 22420,
    })
    expect(baseWithoutPreLtp).toBe(45.5)
  })

  it('should evaluate spike guard trigger condition via isEntrySpikeTriggered', () => {
    // Case 1: Entry price surges > 5% above base
    expect(
      isEntrySpikeTriggered({
        entryPrice: 53.0,
        baseSignalPrice: 50.0, // +6% surge
        optionRiskPoints: 15,
      })
    ).toBe(true)

    // Case 2: Entry price surge exceeds 35% of optionRiskPoints
    expect(
      isEntrySpikeTriggered({
        entryPrice: 54.0,
        baseSignalPrice: 50.0,
        optionRiskPoints: 10, // 4.0 points surge > 3.5 points (0.35 * 10)
      })
    ).toBe(true)

    // Case 3: Within normal 1% spread, below 35% optionRiskPoints
    expect(
      isEntrySpikeTriggered({
        entryPrice: 50.5,
        baseSignalPrice: 50.0,
        optionRiskPoints: 10,
      })
    ).toBe(false)
  })
})
