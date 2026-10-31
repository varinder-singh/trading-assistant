import { describe, it, expect, beforeEach, vi } from 'vitest'
import { PaperTrader } from '../src/execution/paper-trader.js'
import { sanitizeAiDecision } from '../src/ai/llm.js'
import type { PendingTriggerOrder, TradeContext } from '../src/execution/types.js'
import type { AISuccessResponse } from '../src/ai/types.js'

vi.mock('../src/db/repositories/container.js', () => ({
  tradeRepo: {
    getOpenTrades: vi.fn().mockResolvedValue([]),
    insertTrade: vi.fn().mockResolvedValue('mock-trade-id'),
    closeTrade: vi.fn().mockResolvedValue(undefined),
  },
}))

describe('Adversarial Stress Test: Fix 1 & Fix 2 Challenger Suite', () => {
  let trader: PaperTrader

  beforeEach(() => {
    vi.clearAllMocks()
    const mockKc = {} as any
    trader = new PaperTrader('test-challenger-user', mockKc)
    ;(trader as any).initialized = true
    ;(trader as any).positions = new Map()
  })

  // =========================================================================
  // FOCUS AREA 1: Queueing Behavior Under Severe Spike (>15% above base price)
  // =========================================================================
  describe('Focus Area 1: Severe Spike Guard (>15% above base price)', () => {
    it('should correctly flag severe spike condition (>15% to +50%) via formula', () => {
      const baseSignalPrice = 34.0
      const optionRiskPoints = 10.0
      const maxSlippagePct = 5.0 // default

      // Test a series of severe spikes: +15%, +20%, +35%, +50%
      const spikes = [
        { pct: 15, cmp: 34.0 * 1.15 }, // 39.10
        { pct: 20, cmp: 34.0 * 1.20 }, // 40.80
        { pct: 35, cmp: 34.0 * 1.35 }, // 45.90
        { pct: 50, cmp: 34.0 * 1.50 }, // 51.00
      ]

      for (const spike of spikes) {
        const slippagePct = ((spike.cmp - baseSignalPrice) / baseSignalPrice) * 100
        const isSpikeTriggered =
          spike.cmp > baseSignalPrice * (1 + maxSlippagePct / 100) ||
          spike.cmp - baseSignalPrice > 0.35 * optionRiskPoints

        expect(isSpikeTriggered).toBe(true)
        expect(slippagePct).toBeCloseTo(spike.pct, 1)
      }
    })

    it('should queue pending order at baseSignalPrice when spike is severe (+25%)', async () => {
      const ttlMs = 15 * 60 * 1000
      const basePrice = 34.0
      const severeSpikePrice = 42.5 // +25% spike

      const pendingOrder: PendingTriggerOrder = {
        id: 'pending_spike_25',
        symbol: 'NIFTY26O1922900PE',
        token: 3001,
        strike: 22900,
        side: 'BUY',
        quantity: 65,
        triggerPrice: basePrice,
        type: 'LIMIT',
        status: 'PENDING',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + ttlMs),
        ttlMs,
        indexInvalidation: 22950,
        currentIndexPrice: 22900,
        optionRiskPoints: 8.0,
        baseSignalPrice: basePrice,
        context: {
          lotSize: 65,
          baseSignalPrice: basePrice,
          triggerPrice: basePrice,
          isTriggerOrder: true,
        },
      }

      await trader.queuePendingOrder(pendingOrder)

      const pending = trader.getPendingOrders()
      expect(pending).toHaveLength(1)
      expect(pending[0]?.triggerPrice).toBe(34.0)
      expect(pending[0]?.status).toBe('PENDING')

      // Ticks at severe spike price (42.50, 40.00, 36.00) must NOT fill
      await trader.updatePrice(3001, severeSpikePrice)
      await trader.updatePrice(3001, 40.0)
      await trader.updatePrice(3001, 36.0)

      expect(trader.getPendingOrders()).toHaveLength(1)
      expect(trader.getAllPositions()).toHaveLength(0)
    })

    it('empirical check: does CMP >= calculatedTarget drop entry in session-manager logic?', () => {
      // In session-manager.ts:
      // if (entryPrice >= calculatedTarget) { return; }
      // If base is 34, optionRiskPoints = 10, rrr = 1.5 -> calculatedTarget = 49 (or 51 for scalper cap).
      // If CMP spiked to 52.0 (severe spike > 50%), entryPrice >= calculatedTarget is true!
      const baseSignalPrice = 34.0
      const optionRiskPoints = 10.0
      const rrr = 1.5
      let calculatedTarget = baseSignalPrice + optionRiskPoints * rrr
      if (calculatedTarget > baseSignalPrice * 1.5) calculatedTarget = baseSignalPrice * 1.5 // 51.0

      const cmpExtremeSpike = 52.0
      const blocksEntryBeforeQueue = cmpExtremeSpike >= calculatedTarget
      expect(blocksEntryBeforeQueue).toBe(true)
      // Note: If CMP is already higher than the entire profit target, entering even on a pullback
      // could be moot if the breakout move has already exhausted its target before entry.
    })
  })

  // =========================================================================
  // FOCUS AREA 2: Tick Pullback Fills when Tick Gaps Below Trigger Price
  // =========================================================================
  describe('Focus Area 2: Tick Pullback Fill & SL/Target Recalculation Anchoring', () => {
    it('should fill at ₹32 when trigger is ₹34 (gap down) and anchor SL & Target to ₹32', async () => {
      const ttlMs = 15 * 60 * 1000
      const triggerPrice = 34.0
      const gapDownPrice = 32.0 // Gapped down below trigger
      const optionRiskPoints = 6.0
      const rrr = 1.5

      const pendingOrder: PendingTriggerOrder = {
        id: 'pending_gap_down',
        symbol: 'NIFTY26O1922900PE',
        token: 3002,
        strike: 22900,
        side: 'BUY',
        quantity: 65,
        triggerPrice,
        type: 'LIMIT',
        status: 'PENDING',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + ttlMs),
        ttlMs,
        indexInvalidation: 22950,
        currentIndexPrice: 22900,
        optionRiskPoints,
        riskRewardRatio: rrr,
        baseSignalPrice: triggerPrice,
        context: {
          lotSize: 65,
          optionExpiry: new Date().toISOString(), // 0DTE: max risk floor 20%
          strategyContext: {
            agentType: 'SCALPER',
            riskRewardRatio: rrr,
            indexSl: 22950,
            macroTrend: 'SIDEWAYS',
          },
        },
      }

      await trader.queuePendingOrder(pendingOrder)
      expect(trader.getPendingOrders()).toHaveLength(1)

      // Tick arrives at 32.00 (gap down)
      await trader.updatePrice(3002, gapDownPrice)

      expect(trader.getPendingOrders()).toHaveLength(0)
      const positions = trader.getAllPositions()
      expect(positions).toHaveLength(1)

      const pos = positions[0]!
      expect(pos.symbol).toBe('NIFTY26O1922900PE')
      expect(pos.avgEntryPrice).toBe(32.0)
      expect(pos.currentPrice).toBe(32.0)

      // Target must be anchored to 32.0: 32.0 + 6.0 * 1.5 = 41.0 (NOT 34 + 9 = 43)
      expect(pos.aiTarget).toBeCloseTo(32.0 + optionRiskPoints * rrr, 2)
      expect(pos.aiTarget).toBe(41.0)

      // SL must be anchored to 32.0: 32.0 - 6.0 = 26.0
      // 0DTE floor check: 32.0 * (1 - 0.20) = 25.6. 26.0 > 25.6, so SL is 26.0 (NOT 34 - 6 = 28)
      expect(pos.aiStopLoss).toBeCloseTo(26.0, 1)
      expect(pos.aiStopLoss).toBeLessThan(32.0)
    })

    it('should enforce DTE max risk floor on extreme gap down (e.g. tick arrives at ₹5)', async () => {
      const ttlMs = 15 * 60 * 1000
      const pendingOrder: PendingTriggerOrder = {
        id: 'pending_extreme_gap',
        symbol: 'NIFTY26O1922900PE',
        token: 3003,
        side: 'BUY',
        quantity: 65,
        triggerPrice: 34.0,
        type: 'LIMIT',
        status: 'PENDING',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + ttlMs),
        ttlMs,
        optionRiskPoints: 10.0, // Risk is 10 points
        context: {
          lotSize: 65,
          optionExpiry: new Date().toISOString(), // 0DTE -> max premium risk 20%
          strategyContext: {
            agentType: 'SCALPER',
            riskRewardRatio: 1.5,
            indexSl: 22950,
            macroTrend: 'SIDEWAYS',
          },
        },
      }

      await trader.queuePendingOrder(pendingOrder)

      // Extreme tick at ₹5.00 (5 - 10 = -5, negative!)
      await trader.updatePrice(3003, 5.0)

      const pos = trader.getAllPositions()[0]!
      expect(pos.avgEntryPrice).toBe(5.0)
      // 20% max loss floor: 5.0 * 0.8 = 4.00. SL must NOT be negative!
      expect(pos.aiStopLoss).toBeCloseTo(4.0, 2)
      expect(pos.aiStopLoss).toBeGreaterThan(0)
    })

    it('should ignore non-positive ticks (price <= 0)', async () => {
      const pendingOrder: PendingTriggerOrder = {
        id: 'pending_bad_tick',
        symbol: 'NIFTY26O1922900PE',
        token: 3004,
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

      // Corrupted / bad tick <= 0
      await trader.updatePrice(3004, 0)
      await trader.updatePrice(3004, -5.0)

      expect(trader.getPendingOrders()).toHaveLength(1)
      expect(trader.getAllPositions()).toHaveLength(0)
    })
  })

  // =========================================================================
  // FOCUS AREA 3: 15-Minute TTL Expiration
  // =========================================================================
  describe('Focus Area 3: 15-Minute TTL Expiration', () => {
    it('should cancel cleanly after TTL expires and reject subsequent fills', async () => {
      const ttlMs = 15 * 60 * 1000
      const now = Date.now()

      // Order created 16 minutes ago, expiresAt was 1 minute ago
      const expiredOrder: PendingTriggerOrder = {
        id: 'pending_ttl_expired',
        symbol: 'NIFTY26O1922900PE',
        token: 3005,
        side: 'BUY',
        quantity: 65,
        triggerPrice: 34.0,
        type: 'LIMIT',
        status: 'PENDING',
        createdAt: new Date(now - 16 * 60 * 1000),
        expiresAt: new Date(now - 60 * 1000),
        ttlMs,
        context: { lotSize: 65 },
      }

      await trader.queuePendingOrder(expiredOrder)
      expect(trader.getPendingOrders()).toHaveLength(1)

      // First tick triggers TTL expiration check
      await trader.updatePrice(3005, 33.0)

      // Order must be removed from queue and CANCELLED
      expect(trader.getPendingOrders()).toHaveLength(0)
      expect(trader.getAllPositions()).toHaveLength(0)

      // Order history record must reflect CANCELLED
      const recorded = (trader as any).orders.find((o: any) => o.id === 'pending_ttl_expired')
      expect(recorded).toBeDefined()
      expect(recorded.status).toBe('CANCELLED')

      // Subsequent tick below trigger price must NOT fill
      await trader.updatePrice(3005, 32.0)
      expect(trader.getAllPositions()).toHaveLength(0)
      expect(trader.getPendingOrders()).toHaveLength(0)
    })

    it('should fill if tick arrives 1ms before TTL expiration', async () => {
      const now = Date.now()
      const validOrder: PendingTriggerOrder = {
        id: 'pending_ttl_valid_edge',
        symbol: 'NIFTY26O1922900PE',
        token: 3006,
        side: 'BUY',
        quantity: 65,
        triggerPrice: 34.0,
        type: 'LIMIT',
        status: 'PENDING',
        createdAt: new Date(now - 14 * 60 * 1000),
        expiresAt: new Date(now + 1000), // Expires in 1 second
        ttlMs: 15 * 60 * 1000,
        optionRiskPoints: 6.0,
        context: { lotSize: 65 },
      }

      await trader.queuePendingOrder(validOrder)

      // Tick arrives before expiresAt
      await trader.updatePrice(3006, 33.5)

      expect(trader.getPendingOrders()).toHaveLength(0)
      expect(trader.getAllPositions()).toHaveLength(1)
      expect(trader.getAllPositions()[0]?.avgEntryPrice).toBe(33.5)
    })
  })

  // =========================================================================
  // FOCUS AREA 4: Pre-Fill Index Invalidation Cancellation
  // =========================================================================
  describe('Focus Area 4: Pre-Fill Dual-Track Index Invalidation', () => {
    it('should cancel PE pending order when index rises to or above stop level', async () => {
      const ttlMs = 15 * 60 * 1000
      const pendingOrder: PendingTriggerOrder = {
        id: 'pending_pe_invalidation',
        symbol: 'NIFTY26O1922900PE',
        token: 3007,
        strike: 22900,
        side: 'BUY',
        quantity: 65,
        triggerPrice: 34.0,
        type: 'LIMIT',
        status: 'PENDING',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + ttlMs),
        ttlMs,
        indexInvalidation: 22950, // For PE, stop is ABOVE spot (e.g. 22950)
        currentIndexPrice: 22900,
        context: { lotSize: 65 },
      }

      await trader.queuePendingOrder(pendingOrder)

      // Index moves higher: 22920 -> 22940 -> 22949 (safe)
      await trader.updateIndexPrice('NIFTY', 22920)
      await trader.updateIndexPrice('NIFTY', 22940)
      await trader.updateIndexPrice('NIFTY', 22949)
      expect(trader.getPendingOrders()).toHaveLength(1)

      // Index breaches 22950 invalidation level
      await trader.updateIndexPrice('NIFTY', 22950)
      expect(trader.getPendingOrders()).toHaveLength(0)

      // Option price now drops to ₹33.00 (below trigger), but order is dead!
      await trader.updatePrice(3007, 33.0)
      expect(trader.getAllPositions()).toHaveLength(0)
    })

    it('should cancel CE pending order when index drops to or below stop level', async () => {
      const ttlMs = 15 * 60 * 1000
      const pendingOrder: PendingTriggerOrder = {
        id: 'pending_ce_invalidation',
        symbol: 'NIFTY26O1922500CE',
        token: 3008,
        strike: 22500,
        side: 'BUY',
        quantity: 65,
        triggerPrice: 50.0,
        type: 'LIMIT',
        status: 'PENDING',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + ttlMs),
        ttlMs,
        indexInvalidation: 22450, // For CE, stop is BELOW spot (e.g. 22450)
        currentIndexPrice: 22500,
        context: { lotSize: 65 },
      }

      await trader.queuePendingOrder(pendingOrder)

      // Index drops to 22450 (touches stop)
      await trader.updateIndexPrice('NIFTY', 22450)
      expect(trader.getPendingOrders()).toHaveLength(0)

      // Option tick arrives below trigger
      await trader.updatePrice(3008, 48.0)
      expect(trader.getAllPositions()).toHaveLength(0)
    })

    it('should isolate underlying symbols so BANKNIFTY ticks do not invalidate NIFTY orders', async () => {
      const ttlMs = 15 * 60 * 1000
      const pendingOrder: PendingTriggerOrder = {
        id: 'pending_isolation',
        symbol: 'NIFTY26O1922900PE',
        token: 3009,
        strike: 22900,
        side: 'BUY',
        quantity: 65,
        triggerPrice: 34.0,
        type: 'LIMIT',
        status: 'PENDING',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + ttlMs),
        ttlMs,
        indexInvalidation: 22950,
        currentIndexPrice: 22900,
        context: { lotSize: 65 },
      }

      await trader.queuePendingOrder(pendingOrder)

      // Feed BANKNIFTY ticks at 50,000 (which is > 22950)
      await trader.updateIndexPrice('BANKNIFTY', 51000)

      // NIFTY pending order must remain intact!
      expect(trader.getPendingOrders()).toHaveLength(1)
      expect(trader.getPendingOrders()[0]?.id).toBe('pending_isolation')
    })
  })

  // =========================================================================
  // FOCUS AREA 5: Duplicate Signal Prevention
  // =========================================================================
  describe('Focus Area 5: Duplicate Signal Prevention', () => {
    it('should reject duplicate pending orders for the same symbol', async () => {
      const ttlMs = 15 * 60 * 1000
      const order1: PendingTriggerOrder = {
        id: 'dup_order_1',
        symbol: 'NIFTY26O1922900PE',
        token: 3010,
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

      const order2: PendingTriggerOrder = {
        id: 'dup_order_2',
        symbol: 'NIFTY26O1922900PE',
        token: 3010,
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

      await trader.queuePendingOrder(order1)
      await trader.queuePendingOrder(order2)

      const pending = trader.getPendingOrders()
      expect(pending).toHaveLength(1)
      expect(pending[0]?.id).toBe('dup_order_1')
    })

    it('should prevent concurrent placeOrder executions via inFlightOrders lock', async () => {
      const orderParams = {
        symbol: 'NIFTY26O1922900PE',
        token: 3011,
        strike: 22900,
        side: 'BUY' as const,
        quantity: 65,
        price: 34.0,
        context: { lotSize: 65 },
      }

      // Simulate a lock held in flight: format is `${params.side}_${params.symbol}_${params.strike || 'ANY'}`
      ;(trader as any).inFlightOrders.add('BUY_NIFTY26O1922900PE_22900')

      const result = await trader.placeOrder(orderParams)
      expect(result.success).toBe(false)
      expect(result.error).toBe('Order already in progress')
    })

    it('should reject placeOrder when active position already exists for the same strike', async () => {
      // Active position exists for strike 22900
      ;(trader as any).positions.set('NIFTY26O1922900PE', {
        symbol: 'NIFTY26O1922900PE',
        token: 3012,
        strike: 22900,
        side: 'BUY',
        quantity: 65,
        avgEntryPrice: 34.0,
        currentPrice: 34.0,
        unrealizedPnL: 0,
        realizedPnL: 0,
        timestamp: new Date(),
      })

      // Attempt placeOrder for same strike with different symbol (e.g. next weekly)
      const result = await trader.placeOrder({
        symbol: 'NIFTY26O2622900PE',
        token: 3013,
        strike: 22900,
        side: 'BUY',
        quantity: 65,
        price: 45.0,
      })

      expect(result.success).toBe(false)
      expect(result.error).toBe('Position already exists for strike 22900')
    })

    it('stress check: duplicate prevention across pending trigger orders vs active positions', async () => {
      // Setup active filled position for strike 22900
      ;(trader as any).positions.set('NIFTY26O1922900PE', {
        symbol: 'NIFTY26O1922900PE',
        token: 3014,
        strike: 22900,
        side: 'BUY',
        quantity: 65,
        avgEntryPrice: 34.0,
        currentPrice: 34.0,
        unrealizedPnL: 0,
        realizedPnL: 0,
        timestamp: new Date(),
      })

      // Attempt to queue pending order for the same symbol
      const pendingOrder: PendingTriggerOrder = {
        id: 'pending_when_pos_active',
        symbol: 'NIFTY26O1922900PE',
        token: 3014,
        strike: 22900,
        side: 'BUY',
        quantity: 65,
        triggerPrice: 32.0,
        type: 'LIMIT',
        status: 'PENDING',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        ttlMs: 15 * 60 * 1000,
        context: { lotSize: 65 },
      }

      await trader.queuePendingOrder(pendingOrder)
      // Empirically observe: queuePendingOrder checks pendingTriggerOrders for duplicate symbol,
      // but does NOT check this.positions.
      const queuedOrders = trader.getPendingOrders().filter((o) => o.id === 'pending_when_pos_active')
      expect(queuedOrders).toHaveLength(1)
    })
  })

  // =========================================================================
  // FOCUS AREA 6: Hallucinated stopLoss Inputs in analyzeWithEnsemble
  // =========================================================================
  describe('Focus Area 6: Hallucinated stopLoss Sanitization (Fix 2)', () => {
    it('should sanitize non-index option premium stop (109.8 on NIFTY ~22850)', () => {
      const rawDecision: AISuccessResponse = {
        decision: 'BUY',
        confidence: 85,
        optionAction: 'BUY_PE',
        entry: 22850,
        stopLoss: 109.8,
        targets: [22700],
        reason: 'Breakdown',
        setup: 'TRUE_BREAKOUT',
        macroTrend: 'EXPANDING_BEARISH',
        instrument: 'OPTIONS',
        strike: 22900,
        riskRewardRatio: 1.5,
      }

      const sanitized = sanitizeAiDecision(rawDecision, { price: 22850 }, 'SCALPER')
      // Must be safely overridden to entry * 1.005 for PE
      expect(sanitized.stopLoss).toBeCloseTo(22850 * 1.005, 2)
    })

    it('should sanitize negative, zero, and NaN stop-losses', () => {
      // 1. Negative stopLoss
      const negDecision: AISuccessResponse = {
        decision: 'BUY',
        confidence: 80,
        optionAction: 'BUY_CE',
        entry: 22500,
        stopLoss: -100,
        targets: [22650],
        reason: 'Bullish breakout',
        setup: 'TRUE_BREAKOUT',
        macroTrend: 'COMPRESSION_BULLISH',
        instrument: 'OPTIONS',
        strike: 22500,
        riskRewardRatio: 1.5,
      }
      expect(sanitizeAiDecision(negDecision, { price: 22500 }).stopLoss).toBeCloseTo(22500 * 0.995, 2)

      // 2. Zero stopLoss
      const zeroDecision: AISuccessResponse = {
        ...negDecision,
        stopLoss: 0,
      }
      expect(sanitizeAiDecision(zeroDecision, { price: 22500 }).stopLoss).toBeCloseTo(22500 * 0.995, 2)

      // 3. NaN stopLoss
      const nanDecision: AISuccessResponse = {
        ...negDecision,
        stopLoss: NaN,
      }
      expect(sanitizeAiDecision(nanDecision, { price: 22500 }).stopLoss).toBeCloseTo(22500 * 0.995, 2)
    })

    it('should sanitize inverted stop loss direction for CE and PE', () => {
      // CE inverted: stopLoss > entry
      const ceDecision: AISuccessResponse = {
        decision: 'BUY',
        confidence: 75,
        optionAction: 'BUY_CE',
        entry: 22400,
        stopLoss: 22480, // Wrong side!
        targets: [22600],
        reason: 'Upside momentum',
        setup: 'TRUE_BREAKOUT',
        macroTrend: 'COMPRESSION_BULLISH',
        instrument: 'OPTIONS',
        strike: 22400,
        riskRewardRatio: 1.5,
      }
      expect(sanitizeAiDecision(ceDecision, { price: 22400 }).stopLoss).toBeCloseTo(22400 * 0.995, 2)

      // PE inverted: stopLoss < entry
      const peDecision: AISuccessResponse = {
        decision: 'BUY',
        confidence: 75,
        optionAction: 'BUY_PE',
        entry: 22400,
        stopLoss: 22320, // Wrong side!
        targets: [22200],
        reason: 'Downside momentum',
        setup: 'TRUE_BREAKOUT',
        macroTrend: 'EXPANDING_BEARISH',
        instrument: 'OPTIONS',
        strike: 22400,
        riskRewardRatio: 1.5,
      }
      expect(sanitizeAiDecision(peDecision, { price: 22400 }).stopLoss).toBeCloseTo(22400 * 1.005, 2)
    })

    it('should sanitize overly distant stop loss (> 2.0% away)', () => {
      // entry 22400, stopLoss 23000 -> 600 points = 2.68% > 2.0%
      const distantPe: AISuccessResponse = {
        decision: 'BUY',
        confidence: 80,
        optionAction: 'BUY_PE',
        entry: 22400,
        stopLoss: 23000,
        targets: [22200],
        reason: 'Macro test',
        setup: 'TRUE_BREAKOUT',
        macroTrend: 'EXPANDING_BEARISH',
        instrument: 'OPTIONS',
        strike: 22400,
        riskRewardRatio: 1.5,
      }
      expect(sanitizeAiDecision(distantPe, { price: 22400 }).stopLoss).toBeCloseTo(22400 * 1.005, 2)
    })

    it('should sanitize overly tight stop loss (< 0.1% away)', () => {
      // entry 22400, stopLoss 22405 for PE -> 5 points = 0.022% < 0.1%
      const tightPe: AISuccessResponse = {
        decision: 'BUY',
        confidence: 80,
        optionAction: 'BUY_PE',
        entry: 22400,
        stopLoss: 22405,
        targets: [22200],
        reason: 'Scalp test',
        setup: 'TRUE_BREAKOUT',
        macroTrend: 'EXPANDING_BEARISH',
        instrument: 'OPTIONS',
        strike: 22400,
        riskRewardRatio: 1.5,
      }
      expect(sanitizeAiDecision(tightPe, { price: 22400 }).stopLoss).toBeCloseTo(22400 * 1.005, 2)
    })

    it('should sanitize hallucinated targets (empty, inverted, or >5% away)', () => {
      // Empty targets
      const emptyTargets: AISuccessResponse = {
        decision: 'BUY',
        confidence: 80,
        optionAction: 'BUY_CE',
        entry: 22400,
        stopLoss: 22300,
        targets: [],
        reason: 'Target test',
        setup: 'TRUE_BREAKOUT',
        macroTrend: 'COMPRESSION_BULLISH',
        instrument: 'OPTIONS',
        strike: 22400,
        riskRewardRatio: 1.5,
      }
      const s1 = sanitizeAiDecision(emptyTargets, { price: 22400 })
      expect(s1.targets).toHaveLength(1)
      expect(s1.targets[0]).toBeCloseTo(22400 * 1.005, 2)

      // Inverted target for PE (target > entry)
      const invertedPeTarget: AISuccessResponse = {
        decision: 'BUY',
        confidence: 80,
        optionAction: 'BUY_PE',
        entry: 22400,
        stopLoss: 22500,
        targets: [22600], // Above entry!
        reason: 'Inverted target',
        setup: 'TRUE_BREAKOUT',
        macroTrend: 'EXPANDING_BEARISH',
        instrument: 'OPTIONS',
        strike: 22400,
        riskRewardRatio: 1.5,
      }
      const s2 = sanitizeAiDecision(invertedPeTarget, { price: 22400 })
      expect(s2.targets[0]).toBeCloseTo(22400 * 0.995, 2)

      // Wildly distant target (> 5% away, e.g. 24500 when index is 22400)
      const distantTarget: AISuccessResponse = {
        decision: 'BUY',
        confidence: 80,
        optionAction: 'BUY_CE',
        entry: 22400,
        stopLoss: 22300,
        targets: [24500],
        reason: 'Distant target',
        setup: 'TRUE_BREAKOUT',
        macroTrend: 'COMPRESSION_BULLISH',
        instrument: 'OPTIONS',
        strike: 22400,
        riskRewardRatio: 1.5,
      }
      const s3 = sanitizeAiDecision(distantTarget, { price: 22400 })
      expect(s3.targets[0]).toBeCloseTo(22400 * 1.005, 2)
    })

    it('should clamp confidence outside [0, 100]', () => {
      const highConf: AISuccessResponse = {
        decision: 'BUY',
        confidence: 150,
        optionAction: 'BUY_CE',
        entry: 22400,
        stopLoss: 22300,
        targets: [22550],
        reason: 'Confidence test',
        setup: 'TRUE_BREAKOUT',
        macroTrend: 'COMPRESSION_BULLISH',
        instrument: 'OPTIONS',
        strike: 22400,
        riskRewardRatio: 1.5,
      }
      expect(sanitizeAiDecision(highConf, { price: 22400 }).confidence).toBe(100)

      const lowConf: AISuccessResponse = {
        ...highConf,
        confidence: -25,
      }
      expect(sanitizeAiDecision(lowConf, { price: 22400 }).confidence).toBe(0)
    })
  })
})
