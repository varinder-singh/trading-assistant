import { describe, it, expect } from 'vitest'
import { detectTrend } from './trend.js'
import type { Candle } from '../types/analysis.js'

describe('detectTrend', () => {
  const mockCandle = (close: number): Candle => ({
    open: close,
    high: close,
    low: close,
    close: close,
    volume: 100,
    time: Date.now()
  })

  it('should return sideways if not enough candles', () => {
    expect(detectTrend([mockCandle(100)])).toBe('sideways')
  })

  it('should return bullish if change > 0.5%', () => {
    const candles = [
      mockCandle(100),
      ...Array(18).fill(mockCandle(100.3)),
      mockCandle(100.6)
    ]
    expect(detectTrend(candles)).toBe('bullish')
  })

  it('should return bearish if change < -0.5%', () => {
    const candles = [
      mockCandle(100),
      ...Array(18).fill(mockCandle(99.8)),
      mockCandle(99.4)
    ]
    expect(detectTrend(candles)).toBe('bearish')
  })

  it('should return sideways if change is within +/- 0.5%', () => {
    const candles = [
      mockCandle(100),
      ...Array(18).fill(mockCandle(100.1)),
      mockCandle(100.2)
    ]
    expect(detectTrend(candles)).toBe('sideways')
  })

  it('should return sideways if first candle close is zero', () => {
    const candles = [
      mockCandle(0),
      mockCandle(100)
    ]
    expect(detectTrend(candles)).toBe('sideways')
  })
})
