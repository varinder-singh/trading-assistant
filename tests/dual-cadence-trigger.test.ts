import { describe, it, expect, beforeEach, vi } from 'vitest'
import { LiveAnalyzer } from '../src/analysis/live.js'
import * as marketHours from '../src/utils/market-hours.js'

describe('Dual-Cadence Trigger Engine (Fast-Path Anomaly + Structural Cadence)', () => {
  let analyzer: LiveAnalyzer

  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(marketHours, 'isMarketOpen').mockReturnValue(true)
    analyzer = new LiveAnalyzer()
  })

  it('triggers on Price Drift when CMP drifts >= 35 points from lastAnalysisPrice', () => {
    analyzer.setLastAnalysisPrice(23300)

    let breakoutEvent: any = null
    analyzer.on('breakout', (event) => {
      breakoutEvent = event
    })

    // 1. Tick with minor move (+10 pts) -> should not trigger
    analyzer.addTick({
      last_price: 23310,
      instrument_token: 256265,
      received_at: Date.now(),
    })
    expect(breakoutEvent).toBeNull()

    // 2. Tick with >= 35 pts drift downwards -> should trigger
    analyzer.addTick({
      last_price: 23260, // -40 pts
      instrument_token: 256265,
      received_at: Date.now(),
    })

    expect(breakoutEvent).not.toBeNull()
    expect(breakoutEvent.reason).toContain('Price Drift (DOWN): 40.0 pts from last analysis')
    expect(breakoutEvent.tick.last_price).toBe(23260)
  })

  it('triggers on 3m/5m Candle Close Break of Structure (BOS) when closing below prior swing low', () => {
    let breakoutEvent: any = null
    analyzer.on('breakout', (event) => {
      breakoutEvent = event
    })

    const recentCandles = [
      { high: 23340, low: 23325, close: 23330 },
      { high: 23338, low: 23320, close: 23325 },
      { high: 23330, low: 23315, close: 23320 },
      // Current closing candle that breaks below the lowest prior low (23315)
      { high: 23320, low: 23285, close: 23288 },
    ]

    const closingCandle = {
      open: 23318,
      high: 23320,
      low: 23285,
      close: 23288,
      timestamp: Date.now(),
    }

    analyzer.checkCandleClose(closingCandle, 3, recentCandles)

    expect(breakoutEvent).not.toBeNull()
    expect(breakoutEvent.reason).toContain('Break of 3m Swing Low: 23288.00 < 23315.00')
    expect(breakoutEvent.tick.last_price).toBe(23288)
  })

  it('triggers on 3m/5m Candle Close Break of Structure (BOS) when closing above prior swing high (Reversal)', () => {
    let breakoutEvent: any = null
    analyzer.on('breakout', (event) => {
      breakoutEvent = event
    })

    const recentCandles = [
      { high: 23225, low: 23210, close: 23215 },
      { high: 23220, low: 23207, close: 23210 },
      { high: 23218, low: 23208, close: 23215 },
      // Current closing candle that breaks above the highest prior high (23225)
      { high: 23248, low: 23215, close: 23245 },
    ]

    const closingCandle = {
      open: 23216,
      high: 23248,
      low: 23215,
      close: 23245,
      timestamp: Date.now(),
    }

    analyzer.checkCandleClose(closingCandle, 3, recentCandles)

    expect(breakoutEvent).not.toBeNull()
    expect(breakoutEvent.reason).toContain('Break of 3m Swing High: 23245.00 > 23225.00')
    expect(breakoutEvent.tick.last_price).toBe(23245)
  })

  it('triggers on Significant Candle Displacement when range >= 25 pts and body >= 18 pts', () => {
    let breakoutEvent: any = null
    analyzer.on('breakout', (event) => {
      breakoutEvent = event
    })

    const closingCandle = {
      open: 23320,
      high: 23322,
      low: 23290,
      close: 23292, // range: 32, body: 28
      timestamp: Date.now(),
    }

    analyzer.checkCandleClose(closingCandle, 5, [])

    expect(breakoutEvent).not.toBeNull()
    expect(breakoutEvent.reason).toContain('Candle Displacement (5m BEARISH)')
    expect(breakoutEvent.tick.last_price).toBe(23292)
  })

  it('preserves lastAnalysisPrice across session reconnects', () => {
    analyzer.setLastAnalysisPrice(23289.3)
    expect(analyzer.getLastAnalysisPrice()).toBe(23289.3)

    // Simulate session reconnection preservation
    const reconnectedAnalyzer = new LiveAnalyzer()
    reconnectedAnalyzer.setLastAnalysisPrice(analyzer.getLastAnalysisPrice())
    expect(reconnectedAnalyzer.getLastAnalysisPrice()).toBe(23289.3)
  })
})
