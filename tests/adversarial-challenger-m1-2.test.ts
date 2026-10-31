import { describe, it, expect, beforeEach, vi } from 'vitest'
import { PaperTrader } from '../src/execution/paper-trader.js'
import {
  getRatchetedStopLoss,
  isRetractGuardTriggered,
  getExpiryRiskProfile,
  getPremiumStopFloor,
  PEAK_PROFIT_RATCHET_TIERS,
} from '../src/execution/expiry-risk-profile.js'
import { computeTieredTargets } from '../src/execution/tier-calculator.js'
import { tradeRepo } from '../src/db/repositories/container.js'

vi.mock('../src/db/repositories/container.js', () => ({
  tradeRepo: {
    getOpenTrades: vi.fn().mockResolvedValue([]),
    insertTrade: vi.fn().mockResolvedValue('mock-trade-id'),
    closeTrade: vi.fn().mockResolvedValue(undefined),
  },
}))

describe('Challenger M1.2 Adversarial Stress Suite: Fix 3 & Fix 4', () => {
  let trader: PaperTrader

  beforeEach(() => {
    vi.clearAllMocks()
    const mockKc = {} as any
    trader = new PaperTrader('test-challenger-user', mockKc)
    ;(trader as any).initialized = true
    ;(trader as any).positions = new Map()
  })

  // -------------------------------------------------------------------------
  // Focus Area 1: 1-Lot Position Crossing T1 Cushion Lock
  // -------------------------------------------------------------------------
  describe('Focus Area 1: 1-Lot Position Crossing T1 — Exact Cushion Formula Verification', () => {
    it('verifies pos.aiStopLoss locks exactly pos.avgEntryPrice + 0.50 * (price - pos.avgEntryPrice)', async () => {
      const entryPrice = 50.0
      const lotSize = 65

      await trader.placeOrder({
        symbol: 'NIFTY_1LOT_CUSHION_TEST',
        token: 7001,
        side: 'BUY',
        quantity: lotSize,
        price: entryPrice,
        context: {
          lotSize,
          aiStopLoss: 40.0,
          optionDelta: 0.5,
        },
      })

      const pos = trader.getAllPositions()[0]!
      expect(pos).toBeDefined()
      expect(pos.quantity).toBe(65)
      expect(pos.t1Qty).toBe(0) // 1-lot position has t1Qty = 0

      // Case 1A: Price touches T1 at 55.00 (+10% gain)
      // At +10% gain, ratchet tier is +8% (locks 35% = 50 + 0.35 * 5 = 51.75)
      // 50% cushion locks 50 + 0.50 * 5 = 52.50
      // 52.50 > 51.75, so pos.aiStopLoss should be exactly 52.50
      pos.t1Target = 55.0
      await trader.updatePrice(7001, 55.0)

      expect(pos.t1Hit).toBe(true)
      expect(pos.quantity).toBe(65) // No lots sold
      const expectedCushion = parseFloat((entryPrice + 0.5 * (55.0 - entryPrice)).toFixed(2))
      expect(expectedCushion).toBe(52.5)
      expect(pos.aiStopLoss).toBe(52.5)
      expect(pos.trailingSlLocked).toBe(52.5)
      expect(pos.aiStopLoss).toBeGreaterThan(entryPrice)
    })

    it('handles gap-up across T1 and locks 50% of the actual crossing price gain', async () => {
      const entryPrice = 100.0
      const lotSize = 50

      await trader.placeOrder({
        symbol: 'NIFTY_1LOT_GAP_TEST',
        token: 7002,
        side: 'BUY',
        quantity: lotSize,
        price: entryPrice,
        context: {
          lotSize,
          aiStopLoss: 80.0,
          optionDelta: 0.5,
        },
      })

      const pos = trader.getAllPositions()[0]!
      pos.t1Target = 107.0 // +7% target (below +8% ratchet tier)

      // Gap up directly to 107.50
      await trader.updatePrice(7002, 107.5)

      expect(pos.t1Hit).toBe(true)
      // Cushion formula: 100 + 0.50 * (107.50 - 100) = 103.75
      const expectedCushion = parseFloat((entryPrice + 0.5 * (107.5 - entryPrice)).toFixed(2))
      expect(expectedCushion).toBe(103.75)
      expect(pos.aiStopLoss).toBe(103.75)
      expect(pos.trailingSlLocked).toBe(103.75)
    })

    it('ensures Math.max preserves higher ratchet stop if ratchet exceeds 50% cushion', async () => {
      const entryPrice = 50.0
      const lotSize = 65

      await trader.placeOrder({
        symbol: 'NIFTY_1LOT_RATCHET_DOMINANCE',
        token: 7003,
        side: 'BUY',
        quantity: lotSize,
        price: entryPrice,
        context: {
          lotSize,
          aiStopLoss: 40.0,
          optionDelta: 0.5,
        },
      })

      const pos = trader.getAllPositions()[0]!
      pos.t1Target = 56.5

      // Price crosses at 56.80 (+13.6% gain)
      // +12% ratchet tier locks 55% -> 50 + 0.55 * 6.8 = 53.74
      // 50% cushion formula calculates -> 50 + 0.50 * 6.8 = 53.40
      // Math.max(53.74, 53.40) = 53.74
      await trader.updatePrice(7003, 56.8)

      expect(pos.t1Hit).toBe(true)
      expect(pos.aiStopLoss).toBe(53.74)
      expect(pos.trailingSlLocked).toBe(53.74)
      // Crucially, stop loss was NOT downgraded to 53.40!
      expect(pos.aiStopLoss).toBeGreaterThanOrEqual(53.4)
    })
  })

  // -------------------------------------------------------------------------
  // Focus Area 2: Subsequent Pullback on 1-Lot Position — Guaranteed Positive Profit
  // -------------------------------------------------------------------------
  describe('Focus Area 2: Subsequent Pullback on 1-Lot Position — Guaranteed Positive Profit', () => {
    it('verifies position stays open during shallow pullback above cushioned SL', async () => {
      const entryPrice = 50.0
      await trader.placeOrder({
        symbol: 'NIFTY_PULLBACK_SHALLOW',
        token: 7004,
        side: 'BUY',
        quantity: 65,
        price: entryPrice,
        context: { lotSize: 65, aiStopLoss: 40.0 },
      })

      const pos = trader.getAllPositions()[0]!
      pos.t1Target = 55.0
      await trader.updatePrice(7004, 55.0) // Cushioned SL = 52.50

      // Pullback to 53.0 (above 52.50)
      await trader.updatePrice(7004, 53.0)
      expect(trader.getAllPositions()).toHaveLength(1)
      expect(pos.currentPrice).toBe(53.0)
      expect(pos.unrealizedPnL).toBe((53.0 - 50.0) * 65)
    })

    it('verifies pullback to cushioned SL exits with guaranteed positive net profit', async () => {
      const entryPrice = 50.0
      const lotSize = 65

      vi.mocked(tradeRepo.getOpenTrades).mockResolvedValue([
        { id: 'trade-pullback-1', symbol: 'NIFTY_PULLBACK_PROFIT', openedAt: new Date().toISOString() } as any,
      ])

      await trader.placeOrder({
        symbol: 'NIFTY_PULLBACK_PROFIT',
        token: 7005,
        side: 'BUY',
        quantity: lotSize,
        price: entryPrice,
        context: { lotSize, aiStopLoss: 40.0 },
      })

      const pos = trader.getAllPositions()[0]!
      pos.t1Target = 55.0
      await trader.updatePrice(7005, 55.0) // Cushioned SL = 52.50
      expect(pos.aiStopLoss).toBe(52.5)

      // Price drops to 52.40 (triggers SL hit)
      await trader.updatePrice(7005, 52.4)

      // Position should be closed
      expect(trader.getAllPositions()).toHaveLength(0)

      // Verify SELL order was executed at 52.40 via getOrders()
      const sellOrder = trader.getOrders().find((o) => o.side === 'SELL' && o.token === 7005)
      expect(sellOrder).toBeDefined()
      expect(sellOrder!.price).toBe(52.4)
      expect(sellOrder!.quantity).toBe(lotSize)

      // Realized profit calculation: (52.40 - 50.00) * 65 = +156.00 INR
      const exitPrice = sellOrder?.price ?? 0
      const realizedPnL = (exitPrice - entryPrice) * lotSize
      expect(realizedPnL).toBeCloseTo(156.0, 2)
      expect(realizedPnL).toBeGreaterThan(0) // Absolutely positive, never loss or breakeven!
    })

    it('compares with pre-fix baseline: confirms pre-fix breakeven would risk zero or negative profit on pullback', async () => {
      // In pre-fix baseline: SL moved to flat entryPrice (50.00).
      // A pullback dropping to 49.90 caused stop out at -0.10 * 65 = -6.50 INR.
      // With Fix 4 cushion (52.50), the stop out occurs at +2.50 * 65 = +162.50 INR.
      const entry = 50.0
      const target = 55.0
      const preFixSl = entry // 50.0
      const postFixSl = entry + 0.5 * (target - entry) // 52.5

      expect(postFixSl - preFixSl).toBe(2.5) // +2.5 points advantage per share
      expect((postFixSl - entry) * 65).toBe(162.5) // +162.50 INR guaranteed cushion
    })
  })

  // -------------------------------------------------------------------------
  // Focus Area 3: Multi-Lot Position Crossing T1
  // -------------------------------------------------------------------------
  describe('Focus Area 3: Multi-Lot Position Crossing T1 — Partial Exit & Breakeven SL', () => {
    it('executes partial exit of t1Qty and sets flat breakeven stop when T1 gain is below ratchet tier (<8%)', async () => {
      const entryPrice = 50.0
      const lotSize = 65

      await trader.placeOrder({
        symbol: 'NIFTY_2LOT_T1_TEST',
        token: 7006,
        side: 'BUY',
        quantity: lotSize,
        price: entryPrice,
        context: {
          lotSize,
          aiStopLoss: 40.0,
          optionDelta: 0.5,
        },
      })

      const pos = trader.getAllPositions()[0]!
      // Configure 2-lot scenario: 130 qty, 65 at T1, 0 at T2, 65 runner
      pos.quantity = 130
      pos.t1Qty = 65
      pos.t2Qty = 0
      // T1 target at 53.0 (+6% gain, below +8% ratchet threshold)
      pos.t1Target = 53.0
      pos.t2Target = 60.0
      pos.t3Target = 70.0

      // Price reaches T1 at 53.0
      await trader.updatePrice(7006, 53.0)

      expect(pos.t1Hit).toBe(true)
      // Exactly 65 sold, 65 remaining
      expect(pos.quantity).toBe(65)

      // SL moved to flat breakeven (entryPrice = 50.0) because gain (+6%) < +8% ratchet tier
      expect(pos.aiStopLoss).toBe(50.0)
      expect(pos.trailingSlLocked).toBe(50.0)

      // Verify partial sell order recorded in orders
      const partialSell = trader.getOrders().find((o) => o.side === 'SELL' && o.token === 7006)
      expect(partialSell).toBeDefined()
      expect(partialSell!.quantity).toBe(65)
      expect(partialSell!.price).toBe(53.0)
    })

    it('preserves higher ratcheted stop when T1 gain reaches ratchet tier (>=8%)', async () => {
      const entryPrice = 50.0
      const lotSize = 65

      await trader.placeOrder({
        symbol: 'NIFTY_2LOT_T1_RATCHET',
        token: 70062,
        side: 'BUY',
        quantity: lotSize,
        price: entryPrice,
        context: {
          lotSize,
          aiStopLoss: 40.0,
          optionDelta: 0.5,
        },
      })

      const pos = trader.getAllPositions()[0]!
      pos.quantity = 130
      pos.t1Qty = 65
      pos.t2Qty = 0
      // T1 target at 54.0 (+8% gain -> triggers +8% ratchet locking 35% of 4 = 1.4 -> 51.40)
      pos.t1Target = 54.0

      await trader.updatePrice(70062, 54.0)

      expect(pos.t1Hit).toBe(true)
      expect(pos.quantity).toBe(65)
      // Math.max(51.40, 50.0) = 51.40: ratchet stop is preserved above breakeven!
      expect(pos.aiStopLoss).toBe(51.4)
      expect(pos.trailingSlLocked).toBe(51.4)
    })

    it('executes 3-lot position: sells 1 lot at T1, trails to breakeven; sells at T2, trails to T1', async () => {
      const entryPrice = 100.0
      const lotSize = 50

      await trader.placeOrder({
        symbol: 'NIFTY_3LOT_T1_T2_TEST',
        token: 7007,
        side: 'BUY',
        quantity: lotSize,
        price: entryPrice,
        context: {
          lotSize,
          aiStopLoss: 80.0,
          optionDelta: 0.5,
        },
      })

      const pos = trader.getAllPositions()[0]!
      // Configure 3-lot scenario: 150 qty, 50 at T1, 50 at T2, 50 runner
      pos.quantity = 150
      pos.t1Qty = 50
      pos.t2Qty = 50
      pos.t1Target = 106.0 // +6% (< 8% ratchet tier)
      pos.t2Target = 111.0 // +11% (+8% tier locks 35% of 11 = 3.85 -> 103.85, so t1Target 106 is higher!)
      pos.t3Target = 125.0

      // Step 1: Hit T1 at 106
      await trader.updatePrice(7007, 106.0)
      expect(pos.t1Hit).toBe(true)
      expect(pos.quantity).toBe(100) // 150 - 50 = 100 remaining
      expect(pos.aiStopLoss).toBe(100.0) // Breakeven

      // Step 2: Hit T2 at 111
      // At 111, peak gain = +11% (matches +8% tier: 100 + 0.35 * 11 = 103.85)
      // T2 logic moves SL to Math.max(103.85, t1Target=106.0) = 106.0
      await trader.updatePrice(7007, 111.0)
      expect(pos.t2Hit).toBe(true)
      expect(pos.quantity).toBe(50) // 100 - 50 = 50 remaining runner
      // SL moved to T1 level (106.0)
      expect(pos.aiStopLoss).toBe(106.0)
      expect(pos.trailingSlLocked).toBe(106.0)

      // Step 3: Hit T3 at 125 (full exit of runner)
      await trader.updatePrice(7007, 125.0)
      expect(trader.getAllPositions()).toHaveLength(0) // Full position closed
    })
  })

  // -------------------------------------------------------------------------
  // Focus Area 4: Strategy A Fallback in computeTieredTargets
  // -------------------------------------------------------------------------
  describe('Focus Area 4: Strategy A Fallback in computeTieredTargets — Sanity Caps', () => {
    const entryPrice = 100.0
    const aiStopLoss = 80.0
    const delta = 0.5

    it('triggers fallback on 0DTE when t1Target exceeds 1.25 * entryPrice', () => {
      // 0DTE cap is 100 * 1.25 = 125.00
      // AI target at 22450.2 gives indexGain = 50.2, optionGain = 25.1 -> T1 = 125.10 (> 125.00)
      const res = computeTieredTargets({
        entryPrice,
        aiStopLoss,
        optionDelta: delta,
        daysToExpiry: 0.3, // 0DTE (< 1)
        quantity: 65,
        lotSize: 65,
        currentIndexPrice: 22400,
        aiIndexTargets: [22450.2, 22500],
      })

      expect(res).not.toBeNull()
      expect(res!.strategy).toBe('DTE_RISK_MULTIPLES')
      // Fallback 0DTE multiplier m1 = 0.5 -> T1 = 100 + 0.5 * 20 = 110.00
      expect(res!.t1Target).toBe(110.0)
      expect(res!.t2Target).toBe(120.0)
      expect(res!.t3Target).toBe(135.0)
      expect(res!.t1Target).toBeLessThanOrEqual(entryPrice * 1.25)
    })

    it('keeps AI_WAVE_TARGETS on 0DTE when t1Target is exactly at or below 1.25 * entryPrice', () => {
      // Index gain = 50.0 -> optionGain = 25.0 -> T1 = 125.00 (exactly at 1.25x cap)
      const res = computeTieredTargets({
        entryPrice,
        aiStopLoss,
        optionDelta: delta,
        daysToExpiry: 0.5,
        quantity: 65,
        lotSize: 65,
        currentIndexPrice: 22400,
        aiIndexTargets: [22450.0, 22480.0],
      })

      expect(res).not.toBeNull()
      expect(res!.strategy).toBe('AI_WAVE_TARGETS')
      expect(res!.t1Target).toBe(125.0)
      expect(res!.t2Target).toBe(140.0)
    })

    it('triggers fallback on multi-day when t1Target exceeds 1.35 * entryPrice', () => {
      // Multi-day cap is 100 * 1.35 = 135.00
      // Index gain = 70.2 -> optionGain = 35.1 -> T1 = 135.10 (> 135.00)
      const res = computeTieredTargets({
        entryPrice,
        aiStopLoss,
        optionDelta: delta,
        daysToExpiry: 3.0, // Multi-day
        quantity: 65,
        lotSize: 65,
        currentIndexPrice: 22400,
        aiIndexTargets: [22470.2, 22550],
      })

      expect(res).not.toBeNull()
      expect(res!.strategy).toBe('DTE_RISK_MULTIPLES')
      // Multi-day (DTE >= 2 and < 5) m1 = 0.75 -> T1 = 100 + 0.75 * 20 = 115.00
      expect(res!.t1Target).toBe(115.0)
      expect(res!.t1Target).toBeLessThanOrEqual(entryPrice * 1.35)
    })

    it('keeps AI_WAVE_TARGETS on multi-day when t1Target is within 1.35 * entryPrice', () => {
      // Index gain = 60.0 -> optionGain = 30.0 -> T1 = 130.00 (< 135.00)
      const res = computeTieredTargets({
        entryPrice,
        aiStopLoss,
        optionDelta: delta,
        daysToExpiry: 2.0,
        quantity: 65,
        lotSize: 65,
        currentIndexPrice: 22400,
        aiIndexTargets: [22460.0, 22500.0],
      })

      expect(res).not.toBeNull()
      expect(res!.strategy).toBe('AI_WAVE_TARGETS')
      expect(res!.t1Target).toBe(130.0)
      expect(res!.t2Target).toBe(150.0)
    })

    it('handles inverted or non-monotonic AI targets by falling back', () => {
      // t2Target <= t1Target
      const res = computeTieredTargets({
        entryPrice,
        aiStopLoss,
        optionDelta: delta,
        daysToExpiry: 1.0,
        quantity: 65,
        lotSize: 65,
        currentIndexPrice: 22400,
        aiIndexTargets: [22450, 22430], // Inverted!
      })

      expect(res).not.toBeNull()
      expect(res!.strategy).toBe('DTE_RISK_MULTIPLES')
    })
  })

  // -------------------------------------------------------------------------
  // Focus Area 5: Ratchet Monotonicity Under Volatile Price Swings
  // -------------------------------------------------------------------------
  describe('Focus Area 5: Ratchet Monotonicity — Locked Stop-Loss Never Decreases', () => {
    it('verifies that when peak drops from +35% (75% locked) to +15%, locked stop-loss never decreases', async () => {
      const entryPrice = 100.0
      await trader.placeOrder({
        symbol: 'NIFTY_RATCHET_MONOTONIC',
        token: 7008,
        side: 'BUY',
        quantity: 50,
        price: entryPrice,
        context: { aiStopLoss: 80.0 },
      })

      const pos = trader.getAllPositions()[0]!

      // Step 1: Price climbs to 135 (+35% gain) -> matches +35% tier: locks 75% of 35 = 26.25 -> SL = 126.25
      await trader.updatePrice(7008, 135.0)
      expect(pos.peakPrice).toBe(135.0)
      expect(pos.aiStopLoss).toBe(126.25)
      expect(pos.trailingSlLocked).toBe(126.25)

      // Step 2: Price retraces to 128 (above 126.25 stop)
      await trader.updatePrice(7008, 128.0)
      // peakPrice must remain at 135.0
      expect(pos.peakPrice).toBe(135.0)
      // aiStopLoss must NOT decrease!
      expect(pos.aiStopLoss).toBe(126.25)
      expect(pos.trailingSlLocked).toBe(126.25)

      // Step 3: Price drops to 126.20 (hits locked ratchet stop) -> exits immediately
      await trader.updatePrice(7008, 126.2)
      expect(trader.getAllPositions()).toHaveLength(0)

      // Verified: stop was never reduced during the drop from peak
    })

    it('fuzzes getRatchetedStopLoss over 500 monotonically increasing peak prices to verify strict mathematical monotonicity', () => {
      const entry = 100
      let lastSl = 0

      for (let gain = 1; gain <= 100; gain += 0.2) {
        const peak = entry + gain
        const result = getRatchetedStopLoss(entry, peak)
        if (result) {
          // targetSl must be >= lastSl (strictly non-decreasing)
          expect(result.targetSl).toBeGreaterThanOrEqual(lastSl)
          // targetSl must be > entry
          expect(result.targetSl).toBeGreaterThan(entry)
          // targetSl must be <= peak
          expect(result.targetSl).toBeLessThanOrEqual(peak)
          lastSl = result.targetSl
        }
      }
    })

    it('verifies exact tier locks defined in PEAK_PROFIT_RATCHET_TIERS', () => {
      const tiers = PEAK_PROFIT_RATCHET_TIERS
      expect(tiers).toHaveLength(4)
      expect(tiers[0]).toEqual({ minPeakGainPct: 0.35, lockPeakGainRatio: 0.75 })
      expect(tiers[1]).toEqual({ minPeakGainPct: 0.2, lockPeakGainRatio: 0.65 })
      expect(tiers[2]).toEqual({ minPeakGainPct: 0.12, lockPeakGainRatio: 0.55 })
      expect(tiers[3]).toEqual({ minPeakGainPct: 0.08, lockPeakGainRatio: 0.35 })
    })
  })

  // -------------------------------------------------------------------------
  // Focus Area 6: Retract Guard Arming & Triggering (0DTE Dynamics)
  // -------------------------------------------------------------------------
  describe('Focus Area 6: Retract Guard Arming & Triggering (0DTE at +10% Gain, 7% Drop)', () => {
    const zeroDte = getExpiryRiskProfile(0)

    it('verifies 0DTE parameters: activation = 0.10, maxDrop = 0.08, maxLostGain = 0.25, maxRisk = 0.20', () => {
      expect(zeroDte.bucket).toBe('ZERO_DTE')
      expect(zeroDte.retractActivationPct).toBe(0.1)
      expect(zeroDte.maxDropFromPeakPct).toBe(0.08)
      expect(zeroDte.maxLostGainRatio).toBe(0.25)
      expect(zeroDte.maxPremiumRiskPct).toBe(0.2)
    })

    it('verifies guard does not arm when peak gain is below 10%', () => {
      const entry = 100
      const peak = 109.9 // +9.9% gain (< 10%)
      const price = 102.2 // 7% drop from peak

      // Guard is not armed, so returns false
      expect(isRetractGuardTriggered(entry, peak, price, zeroDte)).toBe(false)
    })

    it('verifies 0DTE arms at +10% gain and triggers on 7% drop from peak via lostGainRatio (77% >= 25%)', () => {
      const entry = 100
      const peak = 110.0 // Exactly +10% gain -> guard ARMS
      const price = 102.3 // 7% drop from peak (110 * 0.93 = 102.30)

      // dropFromPeakPct = 7.7 / 110 = 0.07 (7% < 8%)
      // lostGainRatio = 7.7 / 10 = 0.77 (77% >= 25%)
      expect(isRetractGuardTriggered(entry, peak, price, zeroDte)).toBe(true)
    })

    it('verifies 0DTE allows shallow drop (< 25% lost gain) when armed', () => {
      const entry = 100
      const peak = 110.0 // +10% gain
      const price = 108.0 // 2 points lost / 10 points gain = 20% lost gain (< 25%)

      expect(isRetractGuardTriggered(entry, peak, price, zeroDte)).toBe(false)
    })

    it('verifies PaperTrader exits long position when 0DTE Retract Guard triggers', async () => {
      vi.mocked(tradeRepo.getOpenTrades).mockResolvedValue([
        { id: 'trade-retract-1', symbol: 'NIFTY_0DTE_RETRACT_TEST', openedAt: new Date().toISOString() } as any,
      ])

      const todayIso = new Date().toISOString()
      await trader.placeOrder({
        symbol: 'NIFTY_0DTE_RETRACT_TEST',
        token: 7009,
        side: 'BUY',
        quantity: 65,
        price: 100.0,
        context: {
          optionExpiry: todayIso, // 0DTE
          aiStopLoss: 80.0,
        },
      })

      // Peak reaches 110.0 (+10% gain)
      await trader.updatePrice(7009, 110.0)
      expect(trader.getAllPositions()).toHaveLength(1)

      // Drop 7% to 102.30 -> triggers 0DTE retract guard
      await trader.updatePrice(7009, 102.3)
      expect(trader.getAllPositions()).toHaveLength(0) // Closed!

      expect(tradeRepo.closeTrade).toHaveBeenCalledWith(
        'trade-retract-1',
        102.3,
        expect.stringContaining('Peak Profit Retract Guard ZERO_DTE'),
        undefined,
        expect.objectContaining({ peakPrice: 110.0 })
      )
    })
  })
})
