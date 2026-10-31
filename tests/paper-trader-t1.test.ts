import { describe, it, expect, beforeEach, vi } from 'vitest'
import { PaperTrader } from '../src/execution/paper-trader.js'
import { computeTieredTargets } from '../src/execution/tier-calculator.js'
import { tradeRepo } from '../src/db/repositories/container.js'

vi.mock('../src/db/repositories/container.js', () => ({
  tradeRepo: {
    getOpenTrades: vi.fn().mockResolvedValue([]),
    insertTrade: vi.fn().mockResolvedValue('mock-id'),
    closeTrade: vi.fn().mockResolvedValue(undefined),
  },
}))

describe('Fix 4: 1-Lot T1 50% Profit Cushion Lock & Strategy A Fallback Cap', () => {
  let trader: PaperTrader

  beforeEach(() => {
    vi.clearAllMocks()
    const mockKc = {} as any
    trader = new PaperTrader('test-user-id', mockKc)
    ;(trader as any).initialized = true
    ;(trader as any).positions = new Map()
  })

  it('should lock 50% of T1 gain into aiStopLoss and trailingSlLocked for 1-lot trade on T1 touch', async () => {
    // 1-lot trade: quantity = 65, lotSize = 65
    await trader.placeOrder({
      symbol: 'NIFTY_1LOT_CE',
      token: 3001,
      side: 'BUY',
      quantity: 65,
      price: 50.0,
      context: {
        lotSize: 65,
        aiStopLoss: 40.0,
        optionDelta: 0.5,
      },
    })

    const pos = trader.getAllPositions()[0]!
    expect(pos).toBeDefined()
    expect(pos.quantity).toBe(65)
    expect(pos.t1Qty).toBe(0) // 1-lot has 0 partial quantity at T1

    // Manually set t1Target to 55.00 (+10% gain) for predictable testing
    pos.t1Target = 55.0

    // Price crosses T1 target
    await trader.updatePrice(3001, 55.0)

    expect(pos.t1Hit).toBe(true)
    expect(pos.quantity).toBe(65) // No lots sold

    // 50% cushion: entry (50) + 0.50 * (55 - 50) = 52.50
    // (Notice: +8% ratchet tier would only lock 51.75, so T1 cushion gives superior protection)
    expect(pos.aiStopLoss).toBe(52.5)
    expect(pos.trailingSlLocked).toBe(52.5)

    // Pullback to 53.50 (above cushioned SL 52.50) -> remains OPEN
    await trader.updatePrice(3001, 53.5)
    expect(trader.getAllPositions()).toHaveLength(1)

    // Retrace touches cushioned SL 52.50 -> exits profitably
    await trader.updatePrice(3001, 52.4)
    expect(trader.getAllPositions()).toHaveLength(0) // Position closed profitably
  })

  it('should sell t1Qty and move SL to breakeven for multi-lot trade on T1 touch', async () => {
    await trader.placeOrder({
      symbol: 'NIFTY_2LOT_CE',
      token: 3002,
      side: 'BUY',
      quantity: 65,
      price: 50.0,
      context: {
        lotSize: 65,
        aiStopLoss: 40.0,
        optionDelta: 0.5,
      },
    })

    const pos = trader.getAllPositions()[0]!
    // Setup 2-lot scenario (130 qty total, 65 to sell at T1)
    pos.quantity = 130
    pos.t1Qty = 65
    pos.t1Target = 53.0

    // T1 touched at 53.00 (+6% gain, below +8% ratchet tier so SL moves to flat breakeven 50.00)
    await trader.updatePrice(3002, 53.0)

    expect(pos.t1Hit).toBe(true)
    // 65 sold, 65 remaining
    expect(pos.quantity).toBe(65)
    // Multi-lot sets flat breakeven stop at entry
    expect(pos.aiStopLoss).toBe(50.0)
    expect(pos.trailingSlLocked).toBe(50.0)
  })

  it('should fall back to DTE_RISK_MULTIPLES when 0DTE AI target exceeds 1.25 * entryPrice', () => {
    const input = {
      entryPrice: 50.0,
      aiStopLoss: 40.0,
      optionDelta: 0.5,
      daysToExpiry: 0.2, // 0DTE
      quantity: 65,
      lotSize: 65,
      currentIndexPrice: 22400,
      aiIndexTargets: [22800], // 400 index points away -> translates to 50 + 400 * 0.5 = 250 (5x entry!)
    }

    const result = computeTieredTargets(input)
    expect(result).not.toBeNull()
    expect(result!.strategy).toBe('DTE_RISK_MULTIPLES')
    // T1 must be strictly <= 1.25 * entryPrice (62.50)
    expect(result!.t1Target).toBeLessThanOrEqual(50.0 * 1.25)
  })

  it('should fall back to DTE_RISK_MULTIPLES when multi-day AI target exceeds 1.35 * entryPrice', () => {
    const input = {
      entryPrice: 100.0,
      aiStopLoss: 80.0,
      optionDelta: 0.5,
      daysToExpiry: 3.0, // multi-day
      quantity: 65,
      lotSize: 65,
      currentIndexPrice: 22400,
      aiIndexTargets: [22750], // 350 index points -> translates to 100 + 350 * 0.5 = 275 (> 135)
    }

    const result = computeTieredTargets(input)
    expect(result).not.toBeNull()
    expect(result!.strategy).toBe('DTE_RISK_MULTIPLES')
    expect(result!.t1Target).toBeLessThanOrEqual(100.0 * 1.35)
  })

  it('should preserve AI_WAVE_TARGETS strategy when t1Target is within reasonable cap', () => {
    const input = {
      entryPrice: 100.0,
      aiStopLoss: 80.0,
      optionDelta: 0.5,
      daysToExpiry: 2.0,
      quantity: 65,
      lotSize: 65,
      currentIndexPrice: 22400,
      // Target 22436 -> gain = 36 * 0.5 = 18 -> T1 = 118 (< 135 reasonable cap)
      // Target 22460 -> gain = 60 * 0.5 = 30 -> T2 = 130
      aiIndexTargets: [22436, 22460],
    }

    const result = computeTieredTargets(input)
    expect(result).not.toBeNull()
    expect(result!.strategy).toBe('AI_WAVE_TARGETS')
    expect(result!.t1Target).toBe(118.0)
    expect(result!.t2Target).toBe(130.0)
  })
})
