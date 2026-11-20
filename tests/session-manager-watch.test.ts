import { describe, it, expect, beforeEach, vi } from 'vitest'
import { UserSession } from '../src/execution/session-manager.js'
import * as marketHours from '../src/utils/market-hours.js'
import * as kiteModule from '../src/data/kite.js'
import * as yahooModule from '../src/data/yahoo.js'
import { candleBuilder } from '../src/data/candle-builder.js'
import { universeBootstrapper } from '../src/data/universe-bootstrapper.js'

vi.mock('../src/db/repositories/container.js', () => ({
  userRepo: {
    getUserProfileByUserId: vi.fn().mockResolvedValue({
      watchedSymbol: 'NIFTY',
      watchedMode: 'intraday',
      allowedUniverses: 'INDEX_OPTIONS,EQUITY',
      maxIndexPositions: 4,
      maxActivePositions: 10,
    }),
    updateWatchConfig: vi.fn().mockResolvedValue(undefined),
  },
  tradeRepo: {
    getOpenTrades: vi.fn().mockResolvedValue([]),
  },
  eventRepo: {
    saveEvent: vi.fn().mockResolvedValue(undefined),
  },
  gtiRepo: {
    saveScore: vi.fn().mockResolvedValue(undefined),
  },
  scannerAlertRepo: {
    saveAlert: vi.fn().mockResolvedValue(undefined),
  },
  analysisSnapshotRepo: {
    saveSnapshot: vi.fn().mockResolvedValue(undefined),
  },
}))

describe('UserSession Autonomous NIFTY Watch & Reconnect Guard', () => {
  let session: UserSession
  const mockKc: any = {
    getQuote: vi.fn().mockResolvedValue({}),
  }

  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(universeBootstrapper, 'bootstrapScannerUniverse').mockResolvedValue([])
    vi.spyOn(candleBuilder, 'seedFromKite').mockResolvedValue(undefined)
    vi.spyOn(kiteModule, 'getInstrumentToken').mockResolvedValue(256265)
    const nowSec = Math.floor(Date.now() / 1000)
    vi.spyOn(yahooModule, 'getMultiTimeframeCandles').mockResolvedValue({
      candles1d: [],
      candles1h: [],
      candles30m: [],
      candles15m: [
        { open: 24000, high: 24050, low: 23950, close: 24020, time: nowSec - 900, volume: 1000 },
        { open: 24020, high: 24080, low: 24000, close: 24060, time: nowSec, volume: 1500 },
      ],
      candles5m: [],
    } as any)

    session = new UserSession('test-user', 'mock-access-token', 'mock-api-key', 'PAPER')
    session.kc = mockKc
    // Avoid real ticker connection in unit tests
    session.ticker = {
      connect: vi.fn(),
      disconnect: vi.fn(),
      subscribe: vi.fn(),
      setMode: vi.fn(),
      on: vi.fn(),
      modeFull: 'full',
      modeQuote: 'quote',
    } as any
  })

  it('always attaches breakout listener even when watch() is registered pre-market (!isMarketOpen)', async () => {
    vi.spyOn(marketHours, 'isMarketOpen').mockReturnValue(false)

    await session.watch('NIFTY')

    expect(session.watchedSymbol).toBe('NIFTY')
    expect(session.watchedToken).toBe(256265)
    // The breakout listener MUST be attached even though market is closed
    expect(session.analyzer.listenerCount('breakout')).toBe(1)
    // Levels and base price must be seeded from multi-timeframe candles
    expect(session.analyzer.hasLevels()).toBe(true)
    expect(session.analyzer.getLastAnalysisPrice()).toBeGreaterThan(0)
  })

  it('preserves and ensures breakout listener on idempotent reconnect', async () => {
    vi.spyOn(marketHours, 'isMarketOpen').mockReturnValue(true)

    await session.watch('NIFTY')
    expect(session.analyzer.listenerCount('breakout')).toBe(1)

    // Simulate reconnect: call watch again with same symbol and token
    await session.watch('NIFTY')
    expect(session.analyzer.listenerCount('breakout')).toBe(1)
    expect(session.analyzer.hasLevels()).toBe(true)
  })

  it('autoWatch() initializes watch for targetSymbol even if server starts pre-market', async () => {
    vi.spyOn(marketHours, 'isMarketOpen').mockReturnValue(false)

    await session.autoWatch()

    expect(session.watchedSymbol).toBe('NIFTY')
    expect(session.watchedToken).toBe(256265)
    expect(session.analyzer.listenerCount('breakout')).toBe(1)
  })
})
