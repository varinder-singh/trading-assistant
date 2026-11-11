import { describe, it, expect, vi, beforeEach } from 'vitest'
import { UniverseBootstrapper } from '../src/data/universe-bootstrapper.js'
import { KiteScanner } from '../src/data/kite-scanner.js'
import { AnalysisQueue } from '../src/execution/analysis-queue.js'
import { ScannerAlertRepository } from '../src/db/repositories/scanner-alert-repo.js'
import { AnalysisSnapshotRepository } from '../src/db/repositories/analysis-snapshot-repo.js'

describe('UniverseBootstrapper', () => {
  let classifierMock: any
  let bootstrapper: UniverseBootstrapper
  let scanner: KiteScanner

  beforeEach(() => {
    classifierMock = {
      getCachedInstruments: vi.fn(),
    }
    bootstrapper = new UniverseBootstrapper(classifierMock)
    scanner = new KiteScanner(10, 45000)
  })

  it('filters F&O underlyings and registers matching NSE equity tokens', async () => {
    classifierMock.getCachedInstruments.mockImplementation((kc: any, segment: string) => {
      if (segment === 'NFO') {
        return Promise.resolve([
          { segment: 'NFO-OPT', name: 'RELIANCE' },
          { segment: 'NFO-OPT', name: 'TCS' },
          { segment: 'NFO-OPT', name: 'NIFTY' }, // should be excluded
          { segment: 'NFO-FUT', name: 'INFY' }, // should be excluded
        ])
      }
      if (segment === 'NSE') {
        return Promise.resolve([
          { segment: 'NSE', tradingsymbol: 'RELIANCE', instrument_token: 738561, instrument_type: 'EQ' },
          { segment: 'NSE', tradingsymbol: 'TCS', instrument_token: 2953217, instrument_type: 'EQ' },
          { segment: 'NSE', tradingsymbol: 'GTLINFRA', instrument_token: 999999, instrument_type: 'EQ' }, // not in F&O
        ])
      }
      return Promise.resolve([])
    })

    const tokens = await bootstrapper.bootstrapScannerUniverse({} as any, scanner)

    expect(tokens).toHaveLength(2)
    expect(tokens).toContain(738561)
    expect(tokens).toContain(2953217)
    expect(scanner.getTokens()).toHaveLength(2)
    expect(scanner.getStockState(738561)?.symbol).toBe('RELIANCE')
    expect(scanner.getStockState(2953217)?.symbol).toBe('TCS')
  })

  it('returns existing tokens if scanner is already bootstrapped', async () => {
    scanner.registerStock(12345, 'INFY', true)

    const tokens = await bootstrapper.bootstrapScannerUniverse({} as any, scanner)

    expect(tokens).toEqual([12345])
    expect(classifierMock.getCachedInstruments).not.toHaveBeenCalled()
  })
})

describe('AnalysisQueue', () => {
  it('processes candidates in priority order and enforces rate limiting', async () => {
    const queue = new AnalysisQueue({
      maxQueueSize: 5,
      candidateTtlMs: 5000,
      delayBetweenJobsMs: 50, // fast delay for unit test
    })

    const processedSymbols: string[] = []
    const processor = async (cand: any) => {
      processedSymbols.push(cand.symbol)
    }

    const candA = {
      id: '1',
      token: 101,
      symbol: 'STOCK_A',
      price: 100,
      dayHigh: 105,
      atp: 99,
      volumeSurgeRatio: 3.2,
      changePct: 2.1,
      obi: 0.3,
      priorityScore: 35,
      timestamp: Date.now(),
      expiresAt: Date.now() + 45000,
      isFnoListed: true,
    }

    const candB = {
      ...candA,
      id: '2',
      token: 102,
      symbol: 'STOCK_B',
      priorityScore: 85, // Higher priority
    }

    queue.enqueue(candA, 'user1', processor)
    queue.enqueue(candB, 'user1', processor)

    // Wait for processing to complete
    await new Promise((resolve) => setTimeout(resolve, 200))

    expect(processedSymbols).toContain('STOCK_A')
    expect(processedSymbols).toContain('STOCK_B')
  })

  it('de-duplicates candidate if symbol is already in queue', () => {
    const queue = new AnalysisQueue({ delayBetweenJobsMs: 500 })
    const cand = {
      id: '1',
      token: 101,
      symbol: 'TATASTEEL',
      price: 150,
      dayHigh: 155,
      atp: 148,
      volumeSurgeRatio: 3.5,
      changePct: 3.0,
      obi: 0.5,
      priorityScore: 50,
      timestamp: Date.now(),
      expiresAt: Date.now() + 45000,
      isFnoListed: true,
    }

    const firstEnqueue = queue.enqueue(cand, 'user1', vi.fn())
    expect(firstEnqueue).toBe(true)

    const duplicateEnqueue = queue.enqueue(cand, 'user1', vi.fn())
    expect(duplicateEnqueue).toBe(false)
  })
})

describe('ScannerAlertRepository & AnalysisSnapshotRepository', () => {
  it('saves and queries scanner alerts correctly', async () => {
    const mockDb: any = {
      insertInto: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          executeTakeFirst: vi.fn().mockResolvedValue({}),
        }),
      }),
      updateTable: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            execute: vi.fn().mockResolvedValue({}),
          }),
        }),
      }),
      selectFrom: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              selectAll: vi.fn().mockReturnValue({
                execute: vi.fn().mockResolvedValue([
                  {
                    id: 'alert_1',
                    symbol: 'RELIANCE',
                    token: 738561,
                    price: '2950.50',
                    atp: '2930.00',
                    volumeSurgeRatio: '4.2',
                    changePct: '1.8',
                    obi: '0.45',
                    priorityScore: '68.5',
                    status: 'TRADED',
                    tradingDate: '2026-11-11',
                    createdAt: '2026-11-11T09:30:00.000Z',
                    metadata: JSON.stringify({ isFnoListed: true }),
                  },
                ]),
              }),
            }),
          }),
        }),
      }),
    }

    const repo = new ScannerAlertRepository(mockDb)

    const id = await repo.saveAlert({
      symbol: 'RELIANCE',
      token: 738561,
      price: 2950.5,
      atp: 2930,
      volumeSurgeRatio: 4.2,
      changePct: 1.8,
      obi: 0.45,
      priorityScore: 68.5,
      tradingDate: '2026-11-11',
    })

    expect(id).toBeDefined()
    expect(mockDb.insertInto).toHaveBeenCalledWith('scannerAlerts')

    await repo.updateStatus(id, 'TRADED', { outcome: 'WIN' })
    expect(mockDb.updateTable).toHaveBeenCalledWith('scannerAlerts')

    const alerts = await repo.getTodayAlerts('2026-11-11')
    expect(alerts).toHaveLength(1)
    expect(alerts[0]!.symbol).toBe('RELIANCE')
    expect(alerts[0]!.price).toBe(2950.5)
    expect(alerts[0]!.status).toBe('TRADED')
  })

  it('saves and retrieves active analysis snapshots across reloads', async () => {
    let storedRow: any = null

    const mockDb: any = {
      selectFrom: vi.fn().mockImplementation(() => ({
        where: vi.fn().mockImplementation((col: string, op: string, val: any) => ({
          where: vi.fn().mockImplementation(() => ({
            where: vi.fn().mockImplementation(() => ({
              select: vi.fn().mockReturnValue({
                executeTakeFirst: vi.fn().mockResolvedValue(storedRow ? { id: storedRow.id } : undefined),
              }),
            })),
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                selectAll: vi.fn().mockReturnValue({
                  executeTakeFirst: vi.fn().mockResolvedValue(storedRow),
                }),
              }),
            }),
          })),
        })),
      })),
      insertInto: vi.fn().mockReturnValue({
        values: vi.fn().mockImplementation((val) => {
          storedRow = val
          return { executeTakeFirst: vi.fn().mockResolvedValue({}) }
        }),
      }),
      updateTable: vi.fn().mockReturnValue({
        set: vi.fn().mockImplementation((val) => {
          storedRow = { ...storedRow, ...val }
          return {
            where: vi.fn().mockReturnValue({ execute: vi.fn().mockResolvedValue({}) }),
          }
        }),
      }),
    }

    const repo = new AnalysisSnapshotRepository(mockDb)

    await repo.saveSnapshot({
      userId: 'user_123',
      symbol: 'NIFTY',
      timeframe: '15m',
      support: 24450,
      resistance: 24650,
      vwap: 24520,
      atr: 65,
      levels: { orbHigh: 24600, orbLow: 24480 },
      decision: { decision: 'BUY', strike: 24500 },
      tradingDate: '2026-11-11',
    })

    const retrieved = await repo.getLatestSnapshot('user_123', 'NIFTY')
    expect(retrieved).not.toBeNull()
    expect(retrieved?.support).toBe(24450)
    expect(retrieved?.resistance).toBe(24650)
    expect(retrieved?.decision?.decision).toBe('BUY')
  })
})
