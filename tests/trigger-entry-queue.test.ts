import { describe, it, expect, beforeEach, vi } from 'vitest'
import { PaperTrader } from '../src/execution/paper-trader.js'
import type { PendingTriggerOrder } from '../src/execution/types.js'

vi.mock('../src/db/repositories/container.js', () => ({
  tradeRepo: {
    getOpenTrades: vi.fn().mockResolvedValue([]),
    insertTrade: vi.fn().mockResolvedValue('mock-id'),
    closeTrade: vi.fn().mockResolvedValue(undefined),
  },
}))

describe('Fix 1: Pending Trigger Order Queue & Pullback Engine', () => {
  let trader: PaperTrader

  beforeEach(() => {
    vi.clearAllMocks()
    const mockKc = {} as any
    trader = new PaperTrader('test-user-id', mockKc)
    ;(trader as any).initialized = true
    ;(trader as any).positions = new Map()
  })

  it('should queue pending trigger order when CMP surges > 5% above baseSignalPrice', async () => {
    const ttlMs = 15 * 60 * 1000
    const pendingOrder: PendingTriggerOrder = {
      id: 'pending_1001',
      symbol: 'NIFTY26O1922900PE',
      token: 2001,
      strike: 22900,
      side: 'BUY',
      quantity: 65,
      triggerPrice: 34.0,
      type: 'LIMIT',
      status: 'PENDING',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + ttlMs),
      ttlMs,
      indexInvalidation: 23014.5,
      currentIndexPrice: 22900,
      optionRiskPoints: 10,
      estimatedDelta: 0.5,
      riskRewardRatio: 1.5,
      baseSignalPrice: 34.0,
      context: {
        aiStrike: 22900,
        lotSize: 65,
        isTriggerOrder: true,
      },
    }

    await trader.queuePendingOrder(pendingOrder)

    const pending = trader.getPendingOrders()
    expect(pending).toHaveLength(1)
    expect(pending[0]?.symbol).toBe('NIFTY26O1922900PE')
    expect(pending[0]?.triggerPrice).toBe(34.0)
    expect(pending[0]?.status).toBe('PENDING')
    expect(trader.getAllPositions()).toHaveLength(0)
  })

  it('should remain pending and not fill when ticks are above triggerPrice', async () => {
    const ttlMs = 15 * 60 * 1000
    const pendingOrder: PendingTriggerOrder = {
      id: 'pending_1002',
      symbol: 'NIFTY26O1922900PE',
      token: 2002,
      side: 'BUY',
      quantity: 65,
      triggerPrice: 34.0,
      type: 'LIMIT',
      status: 'PENDING',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + ttlMs),
      ttlMs,
      context: { lotSize: 65 },
    }

    await trader.queuePendingOrder(pendingOrder)

    // Ticks stay above trigger price 34.00
    await trader.updatePrice(2002, 42.0)
    await trader.updatePrice(2002, 38.0)
    await trader.updatePrice(2002, 35.5)

    expect(trader.getPendingOrders()).toHaveLength(1)
    expect(trader.getAllPositions()).toHaveLength(0)
  })

  it('should auto-fill at triggerPrice and recalculate SL and Targets anchored to fill price', async () => {
    const ttlMs = 15 * 60 * 1000
    const pendingOrder: PendingTriggerOrder = {
      id: 'pending_1003',
      symbol: 'NIFTY26O1922900PE',
      token: 2003,
      strike: 22900,
      side: 'BUY',
      quantity: 65,
      triggerPrice: 34.0,
      type: 'LIMIT',
      status: 'PENDING',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + ttlMs),
      ttlMs,
      indexInvalidation: 23014.5,
      currentIndexPrice: 22900,
      optionRiskPoints: 6.0,
      estimatedDelta: 0.5,
      riskRewardRatio: 1.5,
      baseSignalPrice: 34.0,
      context: {
        lotSize: 65,
        optionExpiry: new Date().toISOString(), // 0DTE
        strategyContext: {
          agentType: 'SCALPER',
          indexSl: 23014.5,
          macroTrend: 'SIDEWAYS',
        },
      },
    }

    await trader.queuePendingOrder(pendingOrder)
    expect(trader.getPendingOrders()).toHaveLength(1)

    // Tick reaches triggerPrice (33.90 <= 34.00)
    await trader.updatePrice(2003, 33.9)

    expect(trader.getPendingOrders()).toHaveLength(0)
    const positions = trader.getAllPositions()
    expect(positions).toHaveLength(1)

    const pos = positions[0]!
    expect(pos.symbol).toBe('NIFTY26O1922900PE')
    expect(pos.avgEntryPrice).toBe(33.9)
    expect(pos.currentPrice).toBe(33.9)

    // Target anchored to fill price: fill (33.90) + risk (6.0) * 1.5 = 42.90
    expect(pos.aiTarget).toBeCloseTo(33.9 + 6.0 * 1.5, 2)
    // SL anchored to fill price: 33.90 - 6.0 = 27.90 (bounded by 20% floor = 33.9 * 0.8 = 27.12)
    expect(pos.aiStopLoss).toBeCloseTo(27.9, 1)
  })

  it('should cancel pending trigger order when 15-minute TTL expires', async () => {
    // Queued with expiresAt 1 millisecond in the past
    const pendingOrder: PendingTriggerOrder = {
      id: 'pending_1004',
      symbol: 'NIFTY26O1922900PE',
      token: 2004,
      side: 'BUY',
      quantity: 65,
      triggerPrice: 34.0,
      type: 'LIMIT',
      status: 'PENDING',
      createdAt: new Date(Date.now() - 16 * 60 * 1000),
      expiresAt: new Date(Date.now() - 1000), // Expired 1 second ago
      ttlMs: 15 * 60 * 1000,
      context: { lotSize: 65 },
    }

    await trader.queuePendingOrder(pendingOrder)
    expect(trader.getPendingOrders()).toHaveLength(1)

    // Incoming tick triggers TTL check and expiration
    await trader.updatePrice(2004, 33.5)

    expect(trader.getPendingOrders()).toHaveLength(0)
    expect(trader.getAllPositions()).toHaveLength(0)
  })

  it('should cancel pending order if underlying index crosses invalidation level before fill', async () => {
    const ttlMs = 15 * 60 * 1000
    const pendingOrder: PendingTriggerOrder = {
      id: 'pending_1005',
      symbol: 'NIFTY26O1922900PE',
      token: 2005,
      strike: 22900,
      side: 'BUY',
      quantity: 65,
      triggerPrice: 34.0,
      type: 'LIMIT',
      status: 'PENDING',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + ttlMs),
      ttlMs,
      indexInvalidation: 22950, // Invalidation level above entry for PE
      currentIndexPrice: 22900,
      context: { lotSize: 65 },
    }

    await trader.queuePendingOrder(pendingOrder)
    expect(trader.getPendingOrders()).toHaveLength(1)

    // Index rallies to 22955 (breaches 22950 invalidation level for PE)
    await trader.updateIndexPrice('NIFTY', 22955)

    expect(trader.getPendingOrders()).toHaveLength(0)

    // Subsequent tick below triggerPrice does NOT fill
    await trader.updatePrice(2005, 33.0)
    expect(trader.getAllPositions()).toHaveLength(0)
  })

  it('should reject queueing duplicate pending order for same symbol', async () => {
    const ttlMs = 15 * 60 * 1000
    const pendingOrder1: PendingTriggerOrder = {
      id: 'pending_1006_a',
      symbol: 'NIFTY26O1922900PE',
      token: 2006,
      side: 'BUY',
      quantity: 65,
      triggerPrice: 34.0,
      type: 'LIMIT',
      status: 'PENDING',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + ttlMs),
      ttlMs,
      context: { lotSize: 65 },
    }

    const pendingOrder2: PendingTriggerOrder = {
      id: 'pending_1006_b',
      symbol: 'NIFTY26O1922900PE',
      token: 2006,
      side: 'BUY',
      quantity: 65,
      triggerPrice: 32.0,
      type: 'LIMIT',
      status: 'PENDING',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + ttlMs),
      ttlMs,
      context: { lotSize: 65 },
    }

    await trader.queuePendingOrder(pendingOrder1)
    await trader.queuePendingOrder(pendingOrder2)

    const pending = trader.getPendingOrders()
    expect(pending).toHaveLength(1)
    expect(pending[0]?.id).toBe('pending_1006_a')
  })

  it('should allow manual cancellation of pending trigger order', async () => {
    const ttlMs = 15 * 60 * 1000
    const pendingOrder: PendingTriggerOrder = {
      id: 'pending_1007',
      symbol: 'NIFTY26O1922900PE',
      token: 2007,
      side: 'BUY',
      quantity: 65,
      triggerPrice: 34.0,
      type: 'LIMIT',
      status: 'PENDING',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + ttlMs),
      ttlMs,
      context: { lotSize: 65 },
    }

    await trader.queuePendingOrder(pendingOrder)
    expect(trader.getPendingOrders()).toHaveLength(1)

    const cancelled = await trader.cancelPendingOrder('pending_1007', 'User Manual Cancel')
    expect(cancelled).toBe(true)
    expect(trader.getPendingOrders()).toHaveLength(0)

    // Cannot cancel again
    const cancelledAgain = await trader.cancelPendingOrder('pending_1007')
    expect(cancelledAgain).toBe(false)
  })

  it('should reject queueing pending order when trading is halted', async () => {
    ;(trader as any).tradingHalted = true

    const pendingOrder: PendingTriggerOrder = {
      id: 'pending_halted_1',
      symbol: 'NIFTY26O1922900PE',
      token: 2008,
      side: 'BUY',
      quantity: 65,
      triggerPrice: 34.0,
      type: 'LIMIT',
      status: 'PENDING',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      ttlMs: 15 * 60 * 1000,
      context: { lotSize: 65 },
    }

    await trader.queuePendingOrder(pendingOrder)
    expect(trader.getPendingOrders()).toHaveLength(0)
  })

  it('should cancel pending trigger order at fill time if trading became halted while waiting', async () => {
    const pendingOrder: PendingTriggerOrder = {
      id: 'pending_fill_halt',
      symbol: 'NIFTY26O1922900PE',
      token: 2010,
      side: 'BUY',
      quantity: 65,
      triggerPrice: 34.0,
      type: 'LIMIT',
      status: 'PENDING',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      ttlMs: 15 * 60 * 1000,
      context: { lotSize: 65 },
    }

    await trader.queuePendingOrder(pendingOrder)
    expect(trader.getPendingOrders()).toHaveLength(1)

    // Another position breaches max daily loss while this order is waiting
    ;(trader as any).tradingHalted = true

    // Price hits trigger
    await trader.updatePrice(2010, 33.5)

    // Order must be cancelled, not filled into a position
    expect(trader.getPendingOrders()).toHaveLength(0)
    expect(trader.getAllPositions()).toHaveLength(0)
  })

  it('should cancel pending trigger order at fill time if active positions reached limit while waiting', async () => {
    trader.maxConcurrentPositions = 2

    const pendingOrder: PendingTriggerOrder = {
      id: 'pending_fill_max_pos',
      symbol: 'NIFTY26O1922900PE',
      token: 2011,
      side: 'BUY',
      quantity: 65,
      triggerPrice: 34.0,
      type: 'LIMIT',
      status: 'PENDING',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      ttlMs: 15 * 60 * 1000,
      context: { lotSize: 65 },
    }

    await trader.queuePendingOrder(pendingOrder)
    expect(trader.getPendingOrders()).toHaveLength(1)

    // Active positions reached limit (2) in the meantime
    const positions = (trader as any).positions as Map<string, any>
    positions.set('POS1', { symbol: 'POS1' })
    positions.set('POS2', { symbol: 'POS2' })

    // Price hits trigger
    await trader.updatePrice(2011, 33.5)

    // Order must be cancelled cleanly, not filled
    expect(trader.getPendingOrders()).toHaveLength(0)
    expect(positions.has('NIFTY26O1922900PE')).toBe(false)
  })
})
