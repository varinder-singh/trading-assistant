import { describe, it, expect } from 'vitest'
import { calculateADX } from './adx.js'
import type { Candle } from '../types/analysis.js'

describe('calculateADX', () => {
  it('should return 0s for insufficient data', () => {
    const result = calculateADX([], 14)
    expect(result.adx).toBe(0)
    expect(result.plusDI).toBe(0)
    expect(result.minusDI).toBe(0)
  })

  it('should calculate ADX correctly for a simple trend', () => {
    const candles: Candle[] = Array.from({ length: 35 }, (_, i) => ({
      time: i * 60,
      open: 100 + i,
      high: 102 + i,
      low: 99 + i,
      close: 101 + i,
      volume: 1000,
    }))

    const result = calculateADX(candles, 14)
    expect(result.plusDI).toBeGreaterThan(result.minusDI)
    expect(result.adx).toBeGreaterThan(20) // Trend should be strong
  })
})
