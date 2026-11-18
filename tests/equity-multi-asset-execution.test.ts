import { describe, it, expect, vi, beforeEach } from 'vitest'
import { computeEquityTieredTargets } from '../src/execution/tier-calculator.js'
import {
  getRatchetedStopLoss,
  EQUITY_PROFIT_RATCHET_TIERS,
  STOCK_OPTION_PROFIT_RATCHET_TIERS,
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

    // Quantity split: 50% at T1, 30% at T2, remainder runner to T3
    expect(targets?.t1Qty).toBe(50)
    expect(targets?.t2Qty).toBe(30)
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

  it('calculates downward R-multiple targets and bounds to lower circuit limit for Bearish Short setups', () => {
    const targets = computeEquityTieredTargets({
      entryPrice: 500,
      stopLoss: 510, // ₹10 risk above entry (Short position)
      quantity: 100,
      lowerCircuitPrice: 470,
    })

    expect(targets).not.toBeNull()
    // T1: 500 - 1.2 * 10 = 488
    expect(targets?.t1Target).toBe(488)
    // T2: 500 - 2.0 * 10 = 480
    expect(targets?.t2Target).toBe(480)
    // T3: 500 - 3.0 * 10 = 470, bounded by lowerCircuitPrice * 1.005 = 472.35
    expect(targets?.t3Target).toBe(472.35)
  })
})

describe('Equity Profit Ratchet Tiers', () => {
  it('locks breakeven on +1.0% gain', () => {
    const entry = 1000
    const peak = 1012 // +1.2% peak gain
    const ratchet = getRatchetedStopLoss(entry, peak, EQUITY_PROFIT_RATCHET_TIERS)

    expect(ratchet).toBeDefined()
    expect(ratchet?.peakGainPct).toBeCloseTo(0.012, 3)
    // Tier 1 (+1.0%) locks 15% of gain above entry (cost buffer): 1000 + 0.15 * 12 = 1001.80
    expect(ratchet?.targetSl).toBeCloseTo(1001.8, 1)
  })

  it('locks 45% of peak profit on +1.35% intermediate gain (e.g. TRENT stalling between T1 and T2)', () => {
    const entry = 1000
    const peak = 1014 // +1.4% peak gain
    const ratchet = getRatchetedStopLoss(entry, peak, EQUITY_PROFIT_RATCHET_TIERS)

    expect(ratchet).toBeDefined()
    // Intermediate Tier (+1.3%) locks 45% of gain above entry: 1000 + 0.45 * 14 = 1006.30
    expect(ratchet?.targetSl).toBeCloseTo(1006.3, 1)
  })

  it('locks 55% of peak profit on +2.0% gain', () => {
    const entry = 1000
    const peak = 1020 // +2.0% peak gain
    const ratchet = getRatchetedStopLoss(entry, peak, EQUITY_PROFIT_RATCHET_TIERS)

    expect(ratchet).toBeDefined()
    // Tier 2 (+1.8%) locks 55% of gain above entry: 1000 + 0.55 * 20 = 1011
    expect(ratchet?.targetSl).toBe(1011)
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
    recordPartialExit: vi.fn().mockResolvedValue(undefined),
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

  it('correctly enforces F&O lot size for stock options (never buys Qty: 1)', async () => {
    const res = await paperTrader.placeOrder({
      symbol: 'MFSL26NOV1320CE',
      token: 999123,
      side: 'BUY',
      quantity: 1, // Base input
      price: 42.5,
      context: {
        assetClass: 'STOCK_OPTION',
        product: 'MIS',
        lotSize: 400, // MFSL F&O lot size
        aiStopLoss: 31.87,
        aiTarget: 57.37,
      },
    })

    expect(res.success).toBe(true)
    const pos = paperTrader.getAllPositions().find((p) => p.symbol === 'MFSL26NOV1320CE')
    expect(pos).toBeDefined()
    expect(pos?.quantity).toBe(400) // Correct lot size!
  })

  it('preserves stop loss on high-priced equities (>1000 INR) without index translation mangling', async () => {
    const res = await paperTrader.placeOrder({
      symbol: 'PIIND',
      token: 618521,
      side: 'BUY',
      quantity: 10,
      price: 1772.0,
      context: {
        assetClass: 'EQUITY',
        product: 'MIS',
        aiStopLoss: 1745.0, // Valid stock stop loss > 1000
        aiTarget: 1810.0,
      },
    })

    expect(res.success).toBe(true)
    const pos = paperTrader.getAllPositions().find((p) => p.symbol === 'PIIND')
    expect(pos).toBeDefined()
    // Must remain 1745.0, NOT translated to index premium!
    expect(pos?.aiStopLoss).toBe(1745.0)
    expect(pos?.aiTarget).toBe(1810.0)
  })

  it('labels profitable trailing stop exits as Trailing Stop Hit (Locked Profit), not Stop-Loss hit', async () => {
    await paperTrader.placeOrder({
      symbol: 'STOCK_TRAIL',
      token: 555001,
      side: 'BUY',
      quantity: 100,
      price: 100.0,
      context: {
        assetClass: 'EQUITY',
        product: 'MIS',
        aiStopLoss: 98.0,
        aiTarget: 110.0,
      },
    })

    const notifications: any[] = []
    paperTrader.on('notification', (n) => notifications.push(n))

    // 1. Price surges to 102.50 (+2.5% gain) -> triggers ratchet
    await paperTrader.updatePrice(555001, 102.5)

    const pos = paperTrader.getAllPositions().find((p) => p.symbol === 'STOCK_TRAIL')
    expect(pos?.aiStopLoss).toBeGreaterThan(100.0) // SL locked above entry

    // 2. Price retraces to hit the ratcheted SL
    const lockedSl = pos!.aiStopLoss!
    await paperTrader.updatePrice(555001, lockedSl - 0.05)

    // Position should be closed
    const closed = paperTrader.getAllPositions().find((p) => p.symbol === 'STOCK_TRAIL')
    expect(closed).toBeUndefined()

    // Notification must be info / success lock, NOT error Stop-Loss Hit
    const exitNotif = notifications.find((n) => n.title.includes('Trailing Stop Hit'))
    expect(exitNotif).toBeDefined()
    expect(exitNotif.type).toBe('info')
  })
})

describe('EquityAnalystAgent AI Hallucination Sanitization', () => {
  it('sanitizes option-like hallucinated entry price (e.g. ITC 2.50 vs CMP 287.40)', async () => {
    const { EquityAnalystAgent } = await import('../src/ai/equity-agent.js')
    const mockProvider = {
      chat: vi.fn().mockResolvedValue(`
        {
          "symbol": "ITC",
          "decision": "BUY",
          "action": "BUY_EQUITY",
          "strike": 288,
          "entryPrice": 2.50,
          "stopLoss": 1.50,
          "targets": [2.95, 3.50, 4.00],
          "confidence": 85,
          "holdingMode": "MIS",
          "reason": "Strong volume breakout above VWAP"
        }
      `),
    }

    const agent = new EquityAnalystAgent(mockProvider as any)
    const decision = await agent.evaluate({
      symbol: 'ITC',
      currentPrice: 287.4,
      atp: 286.5,
      changePct: 1.2,
      volumeSurgeRatio: 3.5,
      obi: 0.4,
      tf5m: { price: 287.4, rsi: 62, vwap: 286.8, trend: 'BULLISH' },
      tf15m: { price: 287.4, rsi: 65, vwap: 286.0, trend: 'BULLISH', support: 285.0, resistance: 290.0 },
      relativeStrengthVsNifty: 1.5,
      isFnoListed: true,
    })

    // Entry price MUST be sanitized to CMP
    expect(decision.entryPrice).toBe(287.4)
    // StopLoss MUST be within realistic equity risk
    expect(decision.stopLoss).toBeGreaterThanOrEqual(287.4 * 0.97)
    expect(decision.stopLoss).toBeLessThanOrEqual(287.4 * 0.995)
    // Targets MUST be above 287.4
    expect(decision.targets[0]).toBeGreaterThan(287.4)
    // Strike must be null for BUY_EQUITY
    expect(decision.strike).toBeNull()
  })

  it('validates Bearish Breakdown (BUY_PE / SELL) with stop-loss above entry and descending targets below entry', async () => {
    const { EquityAnalystAgent } = await import('../src/ai/equity-agent.js')
    const mockProvider = {
      chat: vi.fn().mockResolvedValue(`
        {
          "symbol": "HDFCBANK",
          "decision": "SELL",
          "action": "BUY_PE",
          "strike": 1600,
          "entryPrice": 1600,
          "stopLoss": 1620,
          "targets": [1580, 1565, 1545],
          "confidence": 82,
          "holdingMode": "MIS",
          "reason": "Heavy distribution below Exchange VWAP with negative OBI"
        }
      `),
    }

    const agent = new EquityAnalystAgent(mockProvider as any)
    const decision = await agent.evaluate({
      symbol: 'HDFCBANK',
      currentPrice: 1600,
      atp: 1615,
      changePct: -1.8,
      volumeSurgeRatio: 4.2,
      obi: -0.55,
      tf5m: { price: 1600, rsi: 41, vwap: 1612, trend: 'BEARISH' },
      tf15m: { price: 1600, rsi: 44, vwap: 1615, trend: 'BEARISH', support: 1580, resistance: 1620 },
      relativeStrengthVsNifty: -1.2,
      isFnoListed: true,
    })

    expect(decision.decision).toBe('SELL')
    expect(decision.action).toBe('BUY_PE')
    expect(decision.strike).toBe(1600)
    expect(decision.stopLoss).toBe(1620)
    expect(decision.targets).toEqual([1580, 1565, 1545])
  })

  it('blocks overnight cash shorting in CNC mode per SEBI regulations', async () => {
    const { EquityAnalystAgent } = await import('../src/ai/equity-agent.js')
    const mockProvider = {
      chat: vi.fn().mockResolvedValue(`
        {
          "symbol": "NON_FNO_STOCK",
          "decision": "SELL",
          "action": "SELL_EQUITY",
          "strike": null,
          "entryPrice": 500,
          "stopLoss": 510,
          "targets": [490, 480],
          "confidence": 75,
          "holdingMode": "CNC",
          "reason": "Bearish breakdown"
        }
      `),
    }

    const agent = new EquityAnalystAgent(mockProvider as any)
    const decision = await agent.evaluate({
      symbol: 'NON_FNO_STOCK',
      currentPrice: 500,
      atp: 508,
      changePct: -2.0,
      volumeSurgeRatio: 3.5,
      obi: -0.4,
      tf5m: { price: 500, rsi: 30, vwap: 506, trend: 'BEARISH' },
      tf15m: { price: 500, rsi: 33, vwap: 508, trend: 'BEARISH', support: 490, resistance: 510 },
      relativeStrengthVsNifty: -1.5,
      isFnoListed: false,
      equityHoldingMode: 'CNC',
    })

    expect(decision.action).toBe('NONE')
    expect(decision.decision).toBe('NO_TRADE')
  })
})

describe('Stock Option Enhancements: 4 Active Positions, Ratchets & Stagnation', () => {
  let paperTrader: PaperTrader
  const mockRepo: any = {
    getOpenTrades: vi.fn().mockResolvedValue([]),
    getTodaysTrades: vi.fn().mockResolvedValue([]),
    insertTrade: vi.fn().mockResolvedValue(undefined),
    closeTrade: vi.fn().mockResolvedValue(undefined),
    recordPartialExit: vi.fn().mockResolvedValue(undefined),
  }

  beforeEach(() => {
    delete process.env.MAX_ACTIVE_POSITIONS
    delete process.env.MAX_PAPER_POSITIONS
    mockRepo.getOpenTrades.mockReset()
    mockRepo.getOpenTrades.mockResolvedValue([])
    mockRepo.getTodaysTrades.mockReset()
    mockRepo.getTodaysTrades.mockResolvedValue([])
    mockRepo.insertTrade.mockClear()
    mockRepo.closeTrade.mockClear()
    mockRepo.recordPartialExit.mockClear()
    paperTrader = new PaperTrader('test_user', null as any, mockRepo, null as any)
  })

  it('defaults max concurrent active positions to 10', () => {
    expect(paperTrader.maxConcurrentPositions).toBe(10)
  })

  it('calibrated stock option ratchets lock 70% of profit on +14% peak gain', () => {
    const entry = 100
    const peak = 115 // +15% peak gain
    const ratchet = getRatchetedStopLoss(entry, peak, STOCK_OPTION_PROFIT_RATCHET_TIERS)

    expect(ratchet).toBeDefined()
    expect(ratchet?.tier.minPeakGainPct).toBe(0.14)
    // 100 + 0.70 * 15 = 110.50
    expect(ratchet?.targetSl).toBeCloseTo(110.50, 2)
  })

  it('triggers stagnation cutoff for stock options held >60m with <4% gain', async () => {
    await paperTrader.placeOrder({
      symbol: 'STAGNANT26NOV100CE',
      token: 777001,
      side: 'BUY',
      quantity: 100,
      price: 100.0,
      context: {
        assetClass: 'STOCK_OPTION',
        product: 'MIS',
        lotSize: 100,
        aiStopLoss: 75.0,
        aiTarget: 135.0,
      },
    })

    const pos = paperTrader.getAllPositions().find((p) => p.symbol === 'STAGNANT26NOV100CE')
    expect(pos).toBeDefined()

    // Simulate 65 minutes passed
    pos!.timestamp = new Date(Date.now() - 65 * 60 * 1000)

    const notifications: any[] = []
    paperTrader.on('notification', (n) => notifications.push(n))

    // Price is at 101.5 (+1.5% gain, < 4%)
    await paperTrader.updatePrice(777001, 101.5)

    const remaining = paperTrader.getAllPositions().find((p) => p.symbol === 'STAGNANT26NOV100CE')
    expect(remaining).toBeUndefined() // Successfully closed!

    const cutoffNotif = notifications.find((n) => n.title.includes('Stagnation Cutoff'))
    expect(cutoffNotif).toBeDefined()
  })

  it('enforces 20% stop-loss floor on stock options', async () => {
    await paperTrader.placeOrder({
      symbol: 'BHARTI26NOV2100CE',
      token: 888001,
      side: 'BUY',
      quantity: 475,
      price: 50.0,
      context: {
        assetClass: 'STOCK_OPTION',
        product: 'MIS',
        lotSize: 475,
        aiStopLoss: 25.0, // Overly loose stop loss (50% risk)
        aiTarget: 70.0,
      },
    })

    const pos = paperTrader.getAllPositions().find((p) => p.symbol === 'BHARTI26NOV2100CE')
    expect(pos).toBeDefined()
    // 50 * (1 - 0.20) = 40.00
    expect(pos?.aiStopLoss).toBe(40.0)
  })

  it('records partial exit on T1 without closing trade in database', async () => {
    mockRepo.getOpenTrades.mockResolvedValue([
      { id: 'trade-123', symbol: 'PARTIAL_TEST', entryPrice: '100', quantity: 100 },
    ])

    await paperTrader.placeOrder({
      symbol: 'PARTIAL_TEST',
      token: 999001,
      side: 'BUY',
      quantity: 100,
      price: 100.0,
      context: {
        assetClass: 'EQUITY',
        product: 'MIS',
        aiStopLoss: 95.0,
        aiTarget: 110.0,
      },
    })

    const pos = paperTrader.getAllPositions().find((p) => p.symbol === 'PARTIAL_TEST')
    expect(pos).toBeDefined()
    pos!.quantity = 100
    pos!.t1Qty = 35

    // Simulate T1 partial exit
    await paperTrader.placeOrder({
      symbol: 'PARTIAL_TEST',
      token: 999001,
      side: 'SELL',
      quantity: 35,
      price: 105.0,
      context: { aiReasoning: 'T1 target hit' },
    })

    // Remaining 65 shares should still be open
    expect(pos?.quantity).toBe(65)
    // DB recordPartialExit should be called, but NOT closeTrade!
    expect(mockRepo.recordPartialExit).toHaveBeenCalledWith(
      'trade-123',
      'PARTIAL_TEST',
      105.0,
      35,
      65,
      'T1 target hit',
      undefined,
      'SELL'
    )
    expect(mockRepo.closeTrade).not.toHaveBeenCalled()

    // Now sell the remaining 65 shares (final exit)
    await paperTrader.placeOrder({
      symbol: 'PARTIAL_TEST',
      token: 999001,
      side: 'SELL',
      quantity: 65,
      price: 108.0,
      context: { aiReasoning: 'T2 target hit' },
    })

    expect(paperTrader.getAllPositions().find((p) => p.symbol === 'PARTIAL_TEST')).toBeUndefined()
    expect(mockRepo.closeTrade).toHaveBeenCalledWith(
      'trade-123',
      108.0,
      'T2 target hit',
      undefined,
      expect.objectContaining({
        // Total realized PnL: (105-100)*35 + (108-100)*65 = 175 + 520 = 695
        totalRealizedPnL: 695,
      })
    )
  })

  it('moves equity stop loss to breakeven when price reaches 50% of T1 distance (Half-Target Ratchet)', async () => {
    // Entry: 100, SL: 98, T1: 101.4. Half-target distance = (101.4-100)*0.5 = 0.7. Threshold = 100.7.
    const pos: any = {
      symbol: 'RATCHET_TEST',
      token: 999002,
      side: 'BUY',
      quantity: 100,
      avgEntryPrice: 100.0,
      currentPrice: 100.0,
      peakPrice: 100.0,
      assetClass: 'EQUITY',
      product: 'MIS',
      aiStopLoss: 98.0,
      t1Target: 101.4,
      t1Hit: false,
      timestamp: new Date(),
    }
    ;(paperTrader as any).positions.set('RATCHET_TEST', pos)

    // Tick reaches 100.5 (below 100.7 threshold): SL remains 98
    await (paperTrader as any).processPriceTickExits('RATCHET_TEST', pos, 100.5)
    expect(pos.aiStopLoss).toBe(98.0)

    // Tick reaches 100.8 (touches 50% of T1, below 1% full ratchet tier): SL should ratchet to entry price (100.0)
    pos.peakPrice = 100.8
    await (paperTrader as any).processPriceTickExits('RATCHET_TEST', pos, 100.8)
    expect(pos.aiStopLoss).toBe(100.0)
  })

  it('enforces 90m Intraday Momentum Timeout on MIS equities but keeps CNC Swing positions alive', async () => {
    const twoHoursAgo = new Date(Date.now() - 120 * 60 * 1000)

    // MIS (Intraday) position held 120m with 0.1% gain (<0.25% threshold)
    const misPos: any = {
      symbol: 'MIS_STAGNANT',
      token: 999003,
      side: 'BUY',
      quantity: 100,
      avgEntryPrice: 100.0,
      currentPrice: 100.1,
      peakPrice: 100.2,
      assetClass: 'EQUITY',
      product: 'MIS',
      timestamp: twoHoursAgo,
    }

    // CNC (Swing) position held 120m with 0.1% gain
    const cncPos: any = {
      symbol: 'CNC_SWING',
      token: 999004,
      side: 'BUY',
      quantity: 100,
      avgEntryPrice: 100.0,
      currentPrice: 100.1,
      peakPrice: 100.2,
      assetClass: 'EQUITY',
      product: 'CNC',
      timestamp: twoHoursAgo,
    }

    // MIS position should be flagged stagnant
    expect((paperTrader as any).isIntradayEquityStagnant(misPos, 100.1)).toBe(true)

    // CNC (Swing) position MUST NOT be flagged stagnant (kept alive across days)
    expect((paperTrader as any).isIntradayEquityStagnant(cncPos, 100.1)).toBe(false)
  })

  it('squares off MIS positions at 15:30 Market Close but carries CNC Swing positions overnight', async () => {
    const squareOffSpy = vi.spyOn(paperTrader, 'squareOffPositions').mockResolvedValue(undefined)

    const misPos: any = {
      symbol: 'MIS_STOCK',
      token: 999005,
      side: 'BUY',
      quantity: 100,
      avgEntryPrice: 100.0,
      currentPrice: 100.0,
      product: 'MIS',
      assetClass: 'EQUITY',
      timestamp: new Date(),
    }

    const cncPos: any = {
      symbol: 'CNC_SWING_STOCK',
      token: 999006,
      side: 'BUY',
      quantity: 100,
      avgEntryPrice: 100.0,
      currentPrice: 100.0,
      product: 'CNC',
      assetClass: 'EQUITY',
      timestamp: new Date(),
    }

    ;(paperTrader as any).positions.set('MIS_STOCK', misPos)
    ;(paperTrader as any).positions.set('CNC_SWING_STOCK', cncPos)

    // Trigger checkMarketClose at 15:30
    ;(paperTrader as any).checkMarketClose(15, 30)

    // Should only square off MIS_STOCK, preserving CNC_SWING_STOCK
    expect(squareOffSpy).toHaveBeenCalledTimes(1)
    const squaredPositions = squareOffSpy.mock.calls[0]![0]
    expect(squaredPositions).toHaveLength(1)
    expect(squaredPositions[0]!.symbol).toBe('MIS_STOCK')
  })

  it('executes Intraday Short (SELL) equity trades during market falls and computes short PnL accurately', async () => {
    await paperTrader.initialize()
    mockRepo.getOpenTrades.mockResolvedValue([
      {
        id: 'short-trade-1',
        symbol: 'FALLING_STOCK',
        side: 'SELL',
        quantity: 200,
        entryPrice: '500',
        openedAt: new Date().toISOString(),
      },
    ])

    // 1. Place Short Entry Order (SELL at ₹500 with SL at ₹507.50 and T1 at ₹490)
    const entryRes = await paperTrader.placeOrder({
      symbol: 'FALLING_STOCK',
      token: 888001,
      side: 'SELL',
      quantity: 1,
      price: 500.0,
      context: {
        assetClass: 'EQUITY',
        product: 'MIS',
        isShortEntry: true,
        aiStopLoss: 507.5,
        aiTarget: 490.0,
        aiIndexTargets: [490.0, 482.5, 475.0],
        vixLevel: 16.5,
        rsiLevel: 42.0,
        trend15m: 'BEARISH',
      },
    })

    expect(entryRes.success).toBe(true)
    const pos = paperTrader.getAllPositions().find((p) => p.symbol === 'FALLING_STOCK')
    expect(pos).toBeDefined()
    expect(pos?.side).toBe('SELL')
    // Risk budget 1500 / (507.5 - 500) = 200 shares
    expect(pos?.quantity).toBe(200)
    expect(pos?.t1Target).toBe(490.0)

    // 2. Price drops to ₹492: Unrealized PnL should be positive (+₹8 * 200 = +₹1,600)
    await paperTrader.updatePrice(888001, 492.0)
    expect(pos?.unrealizedPnL).toBe(1600)
    expect(pos?.peakPrice).toBe(492.0)
    // Because ₹492 is +1.6% gain on short (tier >= 1.3% locks 45% of 8 pts = 3.60 below 500 -> 496.4), SL is ratcheted below breakeven!
    expect(pos?.aiStopLoss).toBeLessThanOrEqual(500.0)
    expect(mockRepo.insertTrade).toHaveBeenCalledTimes(1)
    expect(mockRepo.insertTrade).toHaveBeenCalledWith(expect.objectContaining({ side: 'SELL', symbol: 'FALLING_STOCK' }))

    // 3. Price spikes back up to hit SL: cover BUY order must close the short WITHOUT inserting a ghost BUY trade!
    await paperTrader.updatePrice(888001, 501.0)
    expect(paperTrader.getAllPositions().find((p) => p.symbol === 'FALLING_STOCK')).toBeUndefined()
    expect(mockRepo.closeTrade).toHaveBeenCalledTimes(1)
    // Critical regression check: closing a short with a BUY cover order must NOT call insertTrade a second time!
    expect(mockRepo.insertTrade).toHaveBeenCalledTimes(1)
  })

  it('enforces re-entry cooldown on Cash Equities (without strike) so a closed stock is not immediately re-bought at the top', async () => {
    await paperTrader.initialize()
    mockRepo.getOpenTrades.mockResolvedValue([
      {
        id: 'trent-trade-1',
        symbol: 'TRENT',
        side: 'BUY',
        quantity: 61,
        entryPrice: '3179.40',
        openedAt: new Date().toISOString(),
      },
    ])

    // 1. Enter TRENT at 3179.40
    const firstEntry = await paperTrader.placeOrder({
      symbol: 'TRENT',
      token: 505001,
      side: 'BUY',
      quantity: 61,
      price: 3179.4,
      context: { assetClass: 'EQUITY', product: 'MIS', aiStopLoss: 3155, aiTarget: 3210 },
    })
    expect(firstEntry.success).toBe(true)

    // 2. Exit TRENT at 3221.90
    const exitRes = await paperTrader.placeOrder({
      symbol: 'TRENT',
      token: 505001,
      side: 'SELL',
      quantity: 61,
      price: 3221.9,
      context: { assetClass: 'EQUITY', product: 'MIS', aiReasoning: 'Manual User Close' },
    })
    expect(exitRes.success).toBe(true)

    // 3. Attempting to re-enter TRENT 24 minutes later at 3224.00 must be blocked by the 45-min equity re-entry cooldown!
    const reEntryRes = await paperTrader.placeOrder({
      symbol: 'TRENT',
      token: 505001,
      side: 'BUY',
      quantity: 61,
      price: 3224.0,
      context: { assetClass: 'EQUITY', product: 'MIS', aiStopLoss: 3207, aiTarget: 3255 },
    })
    expect(reEntryRes.success).toBe(false)
    expect(reEntryRes.error).toBe('Re-entry cooldown active')
  })

  it('reserves NIFTY index slots in the user position pool so stocks cannot starve index trades', async () => {
    paperTrader.configurePool({
      maxActivePositions: 4,
      maxIndexPositions: 1,
      maxDailyTrades: 30,
    })

    // Fill 3 stock slots (maxStockSlots = 4 - 1 = 3)
    for (let i = 1; i <= 3; i++) {
      const res = await paperTrader.placeOrder({
        symbol: `STOCK_${i}`,
        token: 7000 + i,
        side: 'BUY',
        quantity: 10,
        price: 100,
        context: { assetClass: 'EQUITY', product: 'MIS', aiStopLoss: 98, aiTarget: 104 },
      })
      expect(res.success).toBe(true)
    }

    // 4th Stock should be rejected because 1 slot is reserved for NIFTY Index
    const fourthStock = await paperTrader.placeOrder({
      symbol: 'STOCK_4',
      token: 7004,
      side: 'BUY',
      quantity: 10,
      price: 100,
      context: { assetClass: 'EQUITY', product: 'MIS', aiStopLoss: 98, aiTarget: 104 },
    })
    expect(fourthStock.success).toBe(false)
    expect(fourthStock.error).toContain('reserved for Index')

    // NIFTY Index Option SHOULD succeed using its reserved 4th slot
    const niftyRes = await paperTrader.placeOrder({
      symbol: 'NIFTY26NOV25400CE',
      token: 9999,
      side: 'BUY',
      quantity: 65,
      price: 120,
      context: { assetClass: 'INDEX_OPTION', product: 'MIS', lotSize: 65, aiStopLoss: 100, aiTarget: 150 },
    })
    expect(niftyRes.success).toBe(true)
  })

  it('queues and fills Wave Pullback Limit Orders on retracement ticks and cancels on invalidation', async () => {
    await paperTrader.queuePendingOrder({
      id: 'wave_pullback_1',
      symbol: 'WAVE_STOCK',
      token: 666001,
      side: 'BUY',
      quantity: 1,
      triggerPrice: 997.5, // -0.25% pullback below ₹1,000 spike
      type: 'LIMIT',
      status: 'PENDING',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      ttlMs: 15 * 60 * 1000,
      indexInvalidation: 985.0,
      currentIndexPrice: 1000.0,
      context: {
        assetClass: 'EQUITY',
        product: 'MIS',
        aiStopLoss: 985.0,
        aiTarget: 1020.0,
        aiIndexTargets: [1020.0, 1030.0, 1045.0],
      },
    })

    expect(paperTrader.getPendingOrders()).toHaveLength(1)

    // Price stays at ₹999 (above trigger ₹997.5): still pending
    await paperTrader.updatePrice(666001, 999.0)
    expect(paperTrader.getPendingOrders()).toHaveLength(1)

    // Price pulls back to ₹997.0 (<= trigger ₹997.5): order fills at ₹997.0!
    await paperTrader.updatePrice(666001, 997.0)
    expect(paperTrader.getPendingOrders()).toHaveLength(0)

    const filledPos = paperTrader.getAllPositions().find((p) => p.symbol === 'WAVE_STOCK')
    expect(filledPos).toBeDefined()
    expect(filledPos?.avgEntryPrice).toBe(997.0)
  })

  it('RSI Exhaustion Gate: rejects Bearish entry when 15m RSI < 35 and Bullish entry when 15m RSI > 65', async () => {
    const paperTrader = new PaperTrader('test-rsi-user', null as any, mockRepo, null as any)
    await paperTrader.initialize()

    // 1. Bearish entry (BUY_PE) with oversold RSI (25.0) -> MUST BE REJECTED
    const bearishOversold = await paperTrader.placeOrder({
      symbol: 'HAL26NOV4650PE',
      token: 888100,
      side: 'BUY',
      quantity: 150,
      price: 50.0,
      context: {
        assetClass: 'STOCK_OPTION',
        aiSetup: 'BUY_PE',
        rsiLevel: 25.0,
      },
    })
    expect(bearishOversold.success).toBe(false)
    expect(bearishOversold.error).toContain('RSI oversold exhaustion')

    // 2. Bullish entry (BUY_CE) with overbought RSI (72.0) -> MUST BE REJECTED
    const bullishOverbought = await paperTrader.placeOrder({
      symbol: 'TRENT26NOV3300CE',
      token: 888101,
      side: 'BUY',
      quantity: 100,
      price: 45.0,
      context: {
        assetClass: 'STOCK_OPTION',
        aiSetup: 'BUY_CE',
        rsiLevel: 72.0,
      },
    })
    expect(bullishOverbought.success).toBe(false)
    expect(bullishOverbought.error).toContain('RSI overbought exhaustion')

    // 3. Healthy entry (rsi = 52.0) -> MUST SUCCEED
    const healthyEntry = await paperTrader.placeOrder({
      symbol: 'HEALTHY_STOCK',
      token: 888102,
      side: 'BUY',
      quantity: 10,
      price: 100.0,
      context: {
        assetClass: 'EQUITY',
        aiSetup: 'BUY_EQUITY',
        rsiLevel: 52.0,
      },
    })
    expect(healthyEntry.success).toBe(true)
  })

  it('Burst Velocity Governor: limits new entries to max 5 in any 30-minute rolling window', async () => {
    const paperTrader = new PaperTrader('test-velocity-user', null as any, mockRepo, null as any)
    paperTrader.configurePool({ maxActivePositions: 20, maxEntriesPer30mWindow: 3 })
    await paperTrader.initialize()

    // Place 3 entries (fills the 30-minute burst quota)
    for (let i = 1; i <= 3; i++) {
      const res = await paperTrader.placeOrder({
        symbol: `BURST_${i}`,
        token: 999000 + i,
        side: 'BUY',
        quantity: 10,
        price: 50.0,
        context: { assetClass: 'EQUITY', aiSetup: 'BUY_EQUITY', rsiLevel: 50.0 },
      })
      expect(res.success).toBe(true)
    }

    // 4th entry in same 30m window MUST be throttled
    const fourthEntry = await paperTrader.placeOrder({
      symbol: 'BURST_4',
      token: 999004,
      side: 'BUY',
      quantity: 10,
      price: 50.0,
      context: { assetClass: 'EQUITY', aiSetup: 'BUY_EQUITY', rsiLevel: 50.0 },
    })
    expect(fourthEntry.success).toBe(false)
    expect(fourthEntry.error).toContain('Burst velocity throttle')
  })
})
