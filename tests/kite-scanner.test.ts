import { describe, it, expect, beforeEach } from 'vitest'
import { KiteScanner, BoundedPriorityQueue, type CandidateAlert } from '../src/data/kite-scanner.js'

describe('BoundedPriorityQueue', () => {
  let queue: BoundedPriorityQueue

  beforeEach(() => {
    queue = new BoundedPriorityQueue(3, 1000) // Capacity 3, TTL 1000ms
  })

  it('maintains priority order based on priorityScore', () => {
    const now = Date.now()
    const c1: CandidateAlert = {
      id: '1',
      token: 101,
      symbol: 'STOCK1',
      price: 100,
      dayHigh: 100,
      atp: 99,
      volumeSurgeRatio: 3.2,
      changePct: 2.5,
      obi: 0.2,
      priorityScore: 5.0,
      timestamp: now,
      expiresAt: now + 5000,
      isFnoListed: true,
    }
    const c2: CandidateAlert = { ...c1, id: '2', token: 102, symbol: 'STOCK2', priorityScore: 8.5 }
    const c3: CandidateAlert = { ...c1, id: '3', token: 103, symbol: 'STOCK3', priorityScore: 6.2 }

    queue.push(c1)
    queue.push(c2)
    queue.push(c3)

    expect(queue.size()).toBe(3)
    expect(queue.peek()?.symbol).toBe('STOCK2') // Highest priority first
    expect(queue.pop()?.symbol).toBe('STOCK2')
    expect(queue.pop()?.symbol).toBe('STOCK3')
    expect(queue.pop()?.symbol).toBe('STOCK1')
  })

  it('evicts lowest priority item when capacity is exceeded', () => {
    const now = Date.now()
    const base: CandidateAlert = {
      id: '1',
      token: 101,
      symbol: 'A',
      price: 100,
      dayHigh: 100,
      atp: 99,
      volumeSurgeRatio: 3.0,
      changePct: 1,
      obi: 0.1,
      priorityScore: 4.0,
      timestamp: now,
      expiresAt: now + 5000,
      isFnoListed: false,
    }

    queue.push({ ...base, symbol: 'LOW', priorityScore: 2.0 })
    queue.push({ ...base, symbol: 'MED', priorityScore: 5.0 })
    queue.push({ ...base, symbol: 'HIGH', priorityScore: 7.0 })

    expect(queue.size()).toBe(3)

    // Push item with higher priority than LOW (2.0)
    const pushed = queue.push({ ...base, symbol: 'NEW_BETTER', priorityScore: 6.0 })
    expect(pushed).toBe(true)
    expect(queue.size()).toBe(3)

    const symbols = queue.getItems().map((i) => i.symbol)
    expect(symbols).toContain('HIGH')
    expect(symbols).toContain('NEW_BETTER')
    expect(symbols).toContain('MED')
    expect(symbols).not.toContain('LOW') // LOW was evicted
  })

  it('purges items past their TTL expiration', () => {
    const now = Date.now()
    const stale: CandidateAlert = {
      id: 'stale',
      token: 101,
      symbol: 'STALE',
      price: 100,
      dayHigh: 100,
      atp: 99,
      volumeSurgeRatio: 3.5,
      changePct: 2.0,
      obi: 0.1,
      priorityScore: 9.0,
      timestamp: now - 2000,
      expiresAt: now - 500, // already expired
      isFnoListed: true,
    }

    queue.push(stale)
    expect(queue.size()).toBe(0)
    expect(queue.pop()).toBeUndefined()
  })
})

describe('KiteScanner', () => {
  let scanner: KiteScanner

  beforeEach(() => {
    scanner = new KiteScanner(5, 5000)
    scanner.registerStock(1111, 'RELIANCE', true)
  })

  it('processes tick updates price, OHLC, and ATP correctly', () => {
    scanner.processTick({
      instrument_token: 1111,
      last_price: 2500,
      average_traded_price: 2480,
      ohlc: { open: 2450, high: 2510, low: 2440, close: 2460 },
      volume_traded: 100000,
    })

    const state = scanner.getStockState('RELIANCE')
    expect(state).toBeDefined()
    expect(state?.lastPrice).toBe(2500)
    expect(state?.atp).toBe(2480)
    expect(state?.high).toBe(2510)
    expect(state?.changePct).toBeCloseTo(((2500 - 2460) / 2460) * 100, 2)
  })

  it('computes Order Book Imbalance (OBI) from depth', () => {
    scanner.processTick({
      instrument_token: 1111,
      last_price: 2500,
      depth: {
        buy: [{ quantity: 150 }, { quantity: 100 }], // 250 total
        sell: [{ quantity: 50 }, { quantity: 50 }],   // 100 total
      },
    })

    const state = scanner.getStockState(1111)
    // OBI = (250 - 100) / (250 + 100) = 150 / 350 = 0.428...
    expect(state?.obi).toBeCloseTo(0.429, 2)
  })

  it('detects volume surge and fires candidate_surfaced event when breakout occurs', () => {
    let triggeredCandidate: CandidateAlert | null = null
    scanner.on('candidate_surfaced', (candidate: CandidateAlert) => {
      triggeredCandidate = candidate
    })

    // Tick 1: Baseline volume
    scanner.processTick({
      instrument_token: 1111,
      last_price: 2500,
      average_traded_price: 2490,
      ohlc: { open: 2480, high: 2500, low: 2470, close: 2480 },
      volume_traded: 10000,
    })

    // Tick 2: Sudden explosion in volume (e.g. +50,000 shares in 1 minute) at Day High
    scanner.processTick({
      instrument_token: 1111,
      last_price: 2550,
      average_traded_price: 2500,
      ohlc: { open: 2480, high: 2550, low: 2470, close: 2480 },
      volume_traded: 70000, // +60,000 delta
    })

    const state = scanner.getStockState('RELIANCE')
    expect(state?.volumeSurgeRatio).toBeGreaterThanOrEqual(3.0)
    expect(triggeredCandidate).not.toBeNull()
    const alert = triggeredCandidate as unknown as CandidateAlert
    expect(alert.symbol).toBe('RELIANCE')
    expect(alert.price).toBe(2550)
  })
})
