import { describe, it, expect } from 'vitest'
import { generateTradePlan } from './trade.js'
import type { FifteenMinuteCandle } from '../types/analysis.js'

describe('trade planning', () => {
  const mockCandle: FifteenMinuteCandle = {
    open: 150,
    high: 160,
    low: 140,
    close: 155,
    volume: 1000,
    time: 0,
    trend: 'up',
    price: 155,
    vwap: 150,
    resistance: 200,
    support: 100,
    rsi: 55,
    vwapPosition: 'above'
  }

  describe('generateTradePlan', () => {
    it('should return BUY for swing trade in uptrend', () => {
      const plan = generateTradePlan({ ...mockCandle, trend: 'up', vwapPosition: 'above' }, 'swing')
      expect(plan.decision).toBe('BUY')
    })

    it('should return SELL for swing trade in downtrend', () => {
      const plan = generateTradePlan({ ...mockCandle, trend: 'down', vwapPosition: 'below' }, 'swing')
      expect(plan.decision).toBe('SELL')
    })

    it('should return BUY for intraday trade in uptrend and rsi < 60', () => {
        const plan = generateTradePlan({ ...mockCandle, trend: 'up', rsi: 59 }, 'intraday')
        expect(plan.decision).toBe('BUY')
    })

    it('should return SELL for intraday trade in downtrend and rsi > 40', () => {
        const plan = generateTradePlan({ ...mockCandle, trend: 'down', rsi: 41 }, 'intraday')
        expect(plan.decision).toBe('SELL')
    })

    it('should return NEUTRAL for intraday trade in uptrend and rsi > 60', () => {
        const plan = generateTradePlan({ ...mockCandle, trend: 'up', rsi: 61 }, 'intraday')
        expect(plan.decision).toBe('NEUTRAL')
    })

    it('should return NEUTRAL for intraday trade in downtrend and rsi < 40', () => {
        const plan = generateTradePlan({ ...mockCandle, trend: 'down', rsi: 39 }, 'intraday')
        expect(plan.decision).toBe('NEUTRAL')
    })

    it('should return NEUTRAL for swing trade with conflicting signals', () => {
      const plan = generateTradePlan({ ...mockCandle, trend: 'up', vwapPosition: 'below' }, 'swing')
      expect(plan.decision).toBe('NEUTRAL')
    })
  })
})
