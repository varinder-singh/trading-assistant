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
    expect(pos.peakPrice).toBe(100)
    expect(pos.maxUnrealizedPnL).toBe(0)

    // Tick 1: Price goes up to 110 (+10%)
    await trader.updatePrice(1001, 110)
    expect(pos.currentPrice).toBe(110)
    expect(pos.peakPrice).toBe(110)
    expect(pos.maxUnrealizedPnL).toBe(650) // (110 - 100) * 65

    // Tick 2: Price dips to 105
    await trader.updatePrice(1001, 105)
    expect(pos.currentPrice).toBe(105)
    expect(pos.peakPrice).toBe(110) // Peak remains 110
    expect(pos.maxUnrealizedPnL).toBe(650) // Max PnL remains 650
  })

  it('should ratchet SL to breakeven + 2% when peak gain reaches +15%', async () => {
    await trader.placeOrder({
      symbol: 'NIFTY_TEST_CE',
      token: 1002,
      side: 'BUY',
      quantity: 50,
      price: 100,
      context: { aiStopLoss: 85 },
    })

    const pos = trader.getAllPositions()[0]
    expect(pos.aiStopLoss).toBe(85)

    // Price reaches +16% gain (116)
    await trader.updatePrice(1002, 116)
    expect(pos.peakPrice).toBe(116)
    // Ratchet Tier 1: 100 * 1.02 = 102
    expect(pos.aiStopLoss).toBe(102)
  })

  it('should ratchet SL to 50% of peak gain when peak gain reaches +30%', async () => {
    await trader.placeOrder({
      symbol: 'NIFTY_TEST_CE',
      token: 1003,
      side: 'BUY',
      quantity: 50,
      price: 100,
      context: { aiStopLoss: 85 },
    })

    const pos = trader.getAllPositions()[0]

    // Price reaches +40% gain (140)
    await trader.updatePrice(1003, 140)
    expect(pos.peakPrice).toBe(140)
    // Tier 2 Ratchet (+30%+ peak gain): 100 + 0.50 * 40 = 120
    expect(pos.aiStopLoss).toBe(120)

    // Price drops to 120 -> hits ratcheted SL
    await trader.updatePrice(1003, 119)
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
})
