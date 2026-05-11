import { describe, it, expect } from 'vitest'
import { generateTradePlan, handleIntradayTrade, handleSwingTrade } from './trade.js'
import type { Analysis } from '../types/analysis.js'
import type { MarketMode } from '../types/mode.js'

describe('trade planning', () => {
  const mockAnalysis: Analysis = {
    trend: 'bullish',
    support: 100,
    resistance: 200,
    vwap: 150,
    vwapPosition: 'above',
    price: 150
  }

  describe('generateTradePlan', () => {
    it('should return NO_TRADE if price is in middle of range', () => {
      const analysis = { ...mockAnalysis, price: 150 } // Middle of 100-200
      const plan = generateTradePlan(analysis, 'intraday')
      expect(plan.decision).toBe('NO_TRADE')
      expect(plan.reason).toContain('middle of range')
    })

    it('should return BUY for breakout setup', () => {
      const analysis = { ...mockAnalysis, price: 199.5, trend: 'bullish' } // 200 * 0.9975+
      const plan = generateTradePlan(analysis, 'intraday')
      expect(plan.decision).toBe('BUY')
      expect(plan.reason).toContain('breakout')
    })

    it('should return SELL for resistance rejection', () => {
      const analysis = { ...mockAnalysis, price: 197, trend: 'bearish' } // 200 * 0.985
      const plan = generateTradePlan(analysis, 'intraday')
      expect(plan.decision).toBe('SELL')
      expect(plan.reason).toContain('Rejection')
    })

    it('should return SELL for breakdown setup', () => {
      const analysis = { ...mockAnalysis, price: 100, trend: 'bearish' } // 100 * 1.005-
      const plan = generateTradePlan(analysis, 'intraday')
      expect(plan.decision).toBe('SELL')
      expect(plan.reason).toContain('Breakdown')
    })
  })

  describe('handleIntradayTrade', () => {
    it('should return NO_TRADE for middle zone', () => {
      const plan = handleIntradayTrade({ ...mockAnalysis, price: 150 })
      expect(plan?.decision).toBe('NO_TRADE')
    })

    it('should handle breakout', () => {
      const plan = handleIntradayTrade({ ...mockAnalysis, price: 199.5, trend: 'bullish' })
      expect(plan?.decision).toBe('BUY')
    })
  })

  describe('handleSwingTrade', () => {
    it('should return BUY for strong bullish trend even in mid zone', () => {
      const plan = handleSwingTrade({ ...mockAnalysis, price: 150, trend: 'bullish' })
      expect(plan.decision).toBe('BUY')
    })

    it('should return SELL for strong bearish trend', () => {
      const plan = handleSwingTrade({ ...mockAnalysis, price: 150, trend: 'bearish' })
      expect(plan.decision).toBe('SELL')
    })
  })
})
