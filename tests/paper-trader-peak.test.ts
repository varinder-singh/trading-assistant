import { describe, it, expect, beforeEach, vi } from 'vitest'
import { PaperTrader } from '../src/execution/paper-trader.js'
import { tradeRepo } from '../src/db/repositories/container.js'

vi.mock('../src/db/repositories/container.js', () => ({
  tradeRepo: {
    getOpenTrades: vi.fn().mockResolvedValue([]),
    insertTrade: vi.fn().mockResolvedValue('mock-id'),
    closeTrade: vi.fn().mockResolvedValue(undefined),
  },
}))

describe('PaperTrader High-Watermark Peak Profit Engine', () => {
  let trader: PaperTrader

  beforeEach(() => {
    vi.clearAllMocks()
    const mockKc = {} as any
    trader = new PaperTrader('test-user-id', mockKc)
    ;(trader as any).initialized = true
    ;(trader as any).positions = new Map()
  })

  it('should track peakPrice and maxUnrealizedPnL on tick price updates', async () => {
    await trader.placeOrder({
      symbol: 'NIFTY_TEST_CE',
      token: 1001,
      side: 'BUY',
      quantity: 65,
      price: 100,
      context: { lotSize: 65 },
    })

    const pos = trader.getAllPositions()[0]
    expect(pos?.peakPrice).toBe(100)
    expect(pos?.maxUnrealizedPnL).toBe(0)

    // Tick 1: Price goes up to 110 (+10%)
    await trader.updatePrice(1001, 110)
    expect(pos?.currentPrice).toBe(110)
    expect(pos?.peakPrice).toBe(110)
    expect(pos?.maxUnrealizedPnL).toBe(650) // (110 - 100) * 65

    // Tick 2: Price dips to 105
    await trader.updatePrice(1001, 105)
    expect(pos?.currentPrice).toBe(105)
    expect(pos?.peakPrice).toBe(110) // Peak remains 110
    expect(pos?.maxUnrealizedPnL).toBe(650) // Max PnL remains 650
  })

  it('should ratchet SL to 55% of peak gain when peak gain reaches +12% tier', async () => {
    await trader.placeOrder({
      symbol: 'NIFTY_TEST_CE',
      token: 1002,
      side: 'BUY',
      quantity: 50,
      price: 100,
      context: { aiStopLoss: 85 },
    })

    const pos = trader.getAllPositions()[0]
    expect(pos?.aiStopLoss).toBe(85)

    // Price reaches +16% gain (116) -> matches +12% tier (lockPeakGainRatio: 0.55)
    await trader.updatePrice(1002, 116)
    expect(pos?.peakPrice).toBe(116)
    // Ratchet (+12% tier): 100 + 0.55 * 16 = 108.8
    expect(pos?.aiStopLoss).toBeCloseTo(108.8, 2)
  })

  it('should ratchet SL to 75% of peak gain when peak gain reaches +35% tier', async () => {
    await trader.placeOrder({
      symbol: 'NIFTY_TEST_CE',
      token: 1003,
      side: 'BUY',
      quantity: 50,
      price: 100,
      context: { aiStopLoss: 85 },
    })

    const pos = trader.getAllPositions()[0]

    // Price reaches +40% gain (140) -> matches +35% tier (lockPeakGainRatio: 0.75)
    await trader.updatePrice(1003, 140)
    expect(pos?.peakPrice).toBe(140)
    // Tier (+35%+ peak gain): 100 + 0.75 * 40 = 130
    expect(pos?.aiStopLoss).toBe(130)

    // Price drops below 130 -> hits ratcheted SL
    await trader.updatePrice(1003, 129)
    expect(trader.getAllPositions()).toHaveLength(0) // Position closed
  })

  it('should trigger Peak Retract Guard when price drops >= 12% from peak after a +20% rally', async () => {
    vi.mocked(tradeRepo.getOpenTrades).mockResolvedValue([
      { id: 'trade-1004', symbol: 'NIFTY_TEST_CE', openedAt: new Date().toISOString() } as any,
    ])

    await trader.placeOrder({
      symbol: 'NIFTY_TEST_CE',
      token: 1004,
      side: 'BUY',
      quantity: 50,
      price: 100,
      context: { aiStopLoss: 80 },
    })

    // Surge to 125 (+25% peak gain)
    await trader.updatePrice(1004, 125)
    expect(trader.getAllPositions()).toHaveLength(1)

    // Price drops to 109 (drop from peak = (125-109)/125 = 12.8% drop)
    await trader.updatePrice(1004, 109)
    expect(trader.getAllPositions()).toHaveLength(0) // Position exited by Peak Retract Guard
    expect(tradeRepo.closeTrade).toHaveBeenCalledWith(
      'trade-1004',
      109,
      expect.stringContaining('Peak Profit Retract Guard'),
      undefined,
      expect.objectContaining({ peakPrice: 125 })
    )
  })

  it('should trigger 0DTE Peak Retract Guard on an 8.5% drop from peak', async () => {
    vi.mocked(tradeRepo.getOpenTrades).mockResolvedValue([
      { id: 'trade-1005', symbol: 'NIFTY_0DTE_CE', openedAt: new Date().toISOString() } as any,
    ])

    const todayIso = new Date().toISOString()
    await trader.placeOrder({
      symbol: 'NIFTY_0DTE_CE',
      token: 1005,
      side: 'BUY',
      quantity: 65,
      price: 100,
      context: {
        optionExpiry: todayIso, // 0DTE
        aiStopLoss: 70,
      },
    })

    // Surge to 125 (+25% gain)
    await trader.updatePrice(1005, 125)
    expect(trader.getAllPositions()).toHaveLength(1)

    // Price drops to 114.3 (8.56% drop from peak). On 1-2 DTE this would NOT trigger (needs 12%),
    // but on 0DTE it triggers (threshold is 8%)
    await trader.updatePrice(1005, 114.3)
    expect(trader.getAllPositions()).toHaveLength(0) // Exited on 0DTE retract guard
    expect(tradeRepo.closeTrade).toHaveBeenCalledWith(
      'trade-1005',
      114.3,
      expect.stringContaining('ZERO_DTE'),
      undefined,
      expect.objectContaining({ peakPrice: 125 })
    )
  })

  it('should enforce DTE max premium loss floor when entry stop is absent or too wide', async () => {
    const todayIso = new Date().toISOString()
    await trader.placeOrder({
      symbol: 'NIFTY_FLOOR_CE',
      token: 1006,
      side: 'BUY',
      quantity: 65,
      price: 50,
      context: {
        optionExpiry: todayIso, // 0DTE (max 20% loss -> floor at 40)
        aiStopLoss: 0.05, // Attempted 0.05 stop (would cause 100% loss)
      },
    })

    const pos = trader.getAllPositions()[0]
    expect(pos?.aiStopLoss).toBe(40) // Floored at 50 * (1 - 0.2) = 40

    // Price drops to 39 -> hits floored SL
    await trader.updatePrice(1006, 39)
    expect(trader.getAllPositions()).toHaveLength(0) // Protected from dropping further
  })

  it('should trigger dual-track exit when underlying index crosses structural invalidation', async () => {
    vi.mocked(tradeRepo.getOpenTrades).mockResolvedValue([
      { id: 'trade-1007', symbol: 'NIFTY26O1322700CE', openedAt: new Date().toISOString() } as any,
    ])

    await trader.placeOrder({
      symbol: 'NIFTY26O1322700CE',
      token: 1007,
      side: 'BUY',
      quantity: 65,
      price: 50,
      context: {
        currentIndexPrice: 22700,
        strategyContext: {
          indexSl: 22650, // Invalidation level on NIFTY index
          macroTrend: 'COMPRESSION_BULLISH',
          agentType: 'TREND',
        },
      },
    })

    const pos = trader.getAllPositions()[0]
    expect(pos?.indexInvalidation).toBe(22650)

    // Option price hasn't touched premium SL yet (e.g. 45 vs floor 30)
    await trader.updatePrice(1007, 45)
    expect(trader.getAllPositions()).toHaveLength(1)

    // Underlying index drops to 22648 (breaches 22650 invalidation level)
    await trader.updateIndexPrice('NIFTY', 22648)
    expect(trader.getAllPositions()).toHaveLength(0) // Exited on index invalidation
    expect(tradeRepo.closeTrade).toHaveBeenCalledWith(
      'trade-1007',
      45,
      expect.stringContaining('Index Invalidation'),
      undefined,
      expect.any(Object)
    )
  })
})
