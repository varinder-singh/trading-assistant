import { describe, it, expect, vi, beforeEach } from 'vitest'
import { computeEquityTieredTargets } from '../src/execution/tier-calculator.js'
import {
  getRatchetedStopLoss,
  EQUITY_PROFIT_RATCHET_TIERS,
} from '../src/execution/expiry-risk-profile.js'
import { isIndexSymbol, isNearMonthlyExpiry } from '../src/data/instrument-classifier.js'
import { PaperTrader } from '../src/execution/paper-trader.js'

describe('Equity Tiered Targets & SEBI Capping', () => {
  it('calculates unleveraged R-multiple targets and splits quantity across T1 and T2', () => {
    const targets = computeEquityTieredTargets({
      entryPrice: 100,
      stopLoss: 98, // 2 points risk (2%)
      quantity: 100, // 100 shares
    })

    expect(targets).not.toBeNull()
    // T1: 100 + 1.2 * 2 = 102.40 (+2.4%)
    expect(targets?.t1Target).toBe(102.4)
    // T2: 100 + 2.0 * 2 = 104.00 (+4.0%)
    expect(targets?.t2Target).toBe(104)
    // T3: 100 + 3.0 * 2 = 106.00 (+6.0%)
    expect(targets?.t3Target).toBe(106)

    // Quantity split: 35% at T1, 35% at T2, remainder runner to T3
    expect(targets?.t1Qty).toBe(35)
    expect(targets?.t2Qty).toBe(35)
  })

  it('bounds targets to upper circuit limit price ceiling', () => {
    const targets = computeEquityTieredTargets({
      entryPrice: 100,
      stopLoss: 90, // 10 points risk
      quantity: 100,
      upperCircuitPrice: 110, // +10% Upper circuit
    })

    expect(targets).not.toBeNull()
    // Circuit limit ceiling: 110 * 0.995 = 109.45
    expect(targets?.t1Target).toBeLessThanOrEqual(109.45)
    expect(targets?.t2Target).toBeLessThanOrEqual(109.45)
    expect(targets?.t3Target).toBeLessThanOrEqual(109.45)
  })
})

describe('Equity Profit Ratchet Tiers', () => {
  it('locks breakeven on +1.0% gain', () => {
    const entry = 1000
    const peak = 1012 // +1.2% peak gain
    const ratchet = getRatchetedStopLoss(entry, peak, EQUITY_PROFIT_RATCHET_TIERS)

    expect(ratchet).toBeDefined()
    expect(ratchet?.peakGainPct).toBeCloseTo(0.012, 3)
    // Tier 1 (+1.0%) locks 10% of gain above entry (cost buffer): 1000 + 0.1 * 12 = 1001.20
    expect(ratchet?.targetSl).toBeCloseTo(1001.2, 1)
  })

  it('locks 50% of peak profit on +2.0% gain', () => {
    const entry = 1000
    const peak = 1020 // +2.0% peak gain
    const ratchet = getRatchetedStopLoss(entry, peak, EQUITY_PROFIT_RATCHET_TIERS)

    expect(ratchet).toBeDefined()
    // Tier 2 (+1.8%) locks 50% of gain above entry: 1000 + 0.5 * 20 = 1010
    expect(ratchet?.targetSl).toBe(1010)
  })

  it('locks 70% of peak profit on +3.0% gain', () => {
    const entry = 1000
    const peak = 1030 // +3.0% peak gain
    const ratchet = getRatchetedStopLoss(entry, peak, EQUITY_PROFIT_RATCHET_TIERS)

    expect(ratchet).toBeDefined()
    // Tier 3 (+2.8%) locks 70% of gain above entry: 1000 + 0.7 * 30 = 1021
    expect(ratchet?.targetSl).toBe(1021)
  })
})

describe('Instrument Classifier & SEBI Expiry Protection', () => {
  it('correctly classifies index vs equity symbols', () => {
    expect(isIndexSymbol('NIFTY')).toBe(true)
    expect(isIndexSymbol('BANKNIFTY')).toBe(true)
    expect(isIndexSymbol('RELIANCE')).toBe(false)
    expect(isIndexSymbol('TCS')).toBe(false)
  })

  it('detects when an expiry is within 4 days (SEBI physical delivery risk)', () => {
    const now = new Date()
    const in2Days = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000)
    const in10Days = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000)

    expect(isNearMonthlyExpiry(in2Days)).toBe(true)
    expect(isNearMonthlyExpiry(in10Days)).toBe(false)
  })
})

describe('PaperTrader Scenario A (MIS) vs Scenario B (CNC)', () => {
  let paperTrader: PaperTrader
  const mockRepo: any = {
    getOpenTrades: vi.fn().mockResolvedValue([]),
    getTodaysTrades: vi.fn().mockResolvedValue([]),
    insertTrade: vi.fn().mockResolvedValue(undefined),
    closeTrade: vi.fn().mockResolvedValue(undefined),
  }

  beforeEach(() => {
    paperTrader = new PaperTrader('test_user', null as any, mockRepo, null as any)
  })

  it('sizes cash equity orders dynamically based on risk budget', async () => {
    process.env.EQUITY_RISK_PER_TRADE = '1500' // ₹1500 risk budget

    const res = await paperTrader.placeOrder({
      symbol: 'TATASTEEL',
      token: 895745,
      side: 'BUY',
      quantity: 1, // Will be sized
      price: 150,
      context: {
        assetClass: 'EQUITY',
        product: 'MIS',
        aiStopLoss: 147, // ₹3 risk per share
        aiTarget: 156,
      },
    })

    expect(res.success).toBe(true)
    const pos = paperTrader.getAllPositions().find((p) => p.symbol === 'TATASTEEL')
    expect(pos).toBeDefined()
    // ₹1500 risk / ₹3 SL distance = 500 shares!
    expect(pos?.quantity).toBe(500)
    expect(pos?.product).toBe('MIS')
    expect(pos?.assetClass).toBe('EQUITY')
  })

  it('preserves Scenario B (CNC) positions during 3:15 PM EOD square-off while closing Scenario A (MIS)', async () => {
    // 1. Open an MIS position
    await paperTrader.placeOrder({
      symbol: 'STOCK_MIS',
      token: 101,
      side: 'BUY',
      quantity: 100,
      price: 100,
      context: { assetClass: 'EQUITY', product: 'MIS', aiStopLoss: 98 },
    })

    // 2. Open a CNC position (Scenario B)
    await paperTrader.placeOrder({
      symbol: 'STOCK_CNC',
      token: 102,
      side: 'BUY',
      quantity: 50,
      price: 200,
      context: { assetClass: 'EQUITY', product: 'CNC', aiStopLoss: 195 },
    })

    expect(paperTrader.getAllPositions().length).toBe(2)

    // 3. Trigger selective MIS square-off
    const misPositions = paperTrader.getAllPositions().filter((p) => p.product === 'MIS')
    await paperTrader.squareOffPositions(misPositions, 'Intraday EOD Square-Off (3:15 PM Rule)')

    const remaining = paperTrader.getAllPositions()
    expect(remaining.length).toBe(1)
    expect(remaining[0]?.symbol).toBe('STOCK_CNC') // CNC was preserved!
    expect(remaining[0]?.product).toBe('CNC')
  })
})
