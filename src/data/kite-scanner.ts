import { EventEmitter } from 'node:events'

export interface StockScanState {
  token: number
  symbol: string
  lastPrice: number
  open: number
  high: number
  low: number
  close: number
  changePct: number
  atp: number // Average Traded Price (Official Exchange VWAP)
  volumeTraded: number
  lastCumulativeVolume: number
  minuteBuckets: [number, number, number, number, number] // 5 rolling 1-minute volume deltas
  currentBucketIndex: number
  lastBucketMinute: number
  rolling5mAvgVolume: number
  volumeSurgeRatio: number
  obi: number // Order Book Imbalance: -1.0 to +1.0
  isFnoListed: boolean
  lastSurgeAt?: number
}

export interface CandidateAlert {
  id: string
  token: number
  symbol: string
  price: number
  dayHigh: number
  atp: number
  volumeSurgeRatio: number
  changePct: number
  obi: number
  priorityScore: number
  timestamp: number
  expiresAt: number
  isFnoListed: boolean
}

export class BoundedPriorityQueue {
  private queue: CandidateAlert[] = []

  constructor(
    private readonly capacity: number = 10,
    private readonly ttlMs: number = 45000 // 45s TTL
  ) {}

  public push(candidate: CandidateAlert): boolean {
    this.purgeStale()

    const existingIdx = this.queue.findIndex((c) => c.symbol === candidate.symbol)
    if (existingIdx !== -1) {
      return this.updateExistingCandidate(existingIdx, candidate)
    }

    if (this.queue.length < this.capacity) {
      this.queue.push(candidate)
      this.sort()
      return true
    }

    return this.replaceLowestIfBetter(candidate)
  }

  public pop(): CandidateAlert | undefined {
    this.purgeStale()
    return this.queue.shift()
  }

  public peek(): CandidateAlert | undefined {
    this.purgeStale()
    return this.queue[0]
  }

  public getItems(): CandidateAlert[] {
    this.purgeStale()
    return [...this.queue]
  }

  public size(): number {
    this.purgeStale()
    return this.queue.length
  }

  public clear(): void {
    this.queue = []
  }

  private updateExistingCandidate(index: number, candidate: CandidateAlert): boolean {
    const existing = this.queue[index]!
    if (candidate.priorityScore <= existing.priorityScore) return false

    this.queue[index] = candidate
    this.sort()
    return true
  }

  private replaceLowestIfBetter(candidate: CandidateAlert): boolean {
    const lowest = this.queue[this.queue.length - 1]!
    if (candidate.priorityScore <= lowest.priorityScore) return false

    this.queue[this.queue.length - 1] = candidate
    this.sort()
    return true
  }

  private sort(): void {
    this.queue.sort((a, b) => b.priorityScore - a.priorityScore)
  }

  private purgeStale(): void {
    const now = Date.now()
    this.queue = this.queue.filter((item) => item.expiresAt > now)
  }
}

export class KiteScanner extends EventEmitter {
  private stocks: Map<number, StockScanState> = new Map()
  private symbolToToken: Map<string, number> = new Map()
  public readonly priorityQueue: BoundedPriorityQueue

  private surgeThreshold = 3.0
  private cooldownMs = 15 * 60 * 1000 // 15 mins cooldown per symbol
  private symbolCooldowns: Map<string, number> = new Map()
  private minPrice = 50 // Ignore penny stocks under ₹50

  constructor(capacity = 10, ttlMs = 45000) {
    super()
    this.priorityQueue = new BoundedPriorityQueue(capacity, ttlMs)
  }

  public registerStock(token: number, symbol: string, isFnoListed = false): void {
    const upper = symbol.toUpperCase().trim()
    this.symbolToToken.set(upper, token)

    if (this.stocks.has(token)) return

    this.stocks.set(token, this.createInitialStockState(token, upper, isFnoListed))
  }

  public getTokens(): number[] {
    return Array.from(this.stocks.keys())
  }

  public getStockState(tokenOrSymbol: number | string): StockScanState | undefined {
    if (typeof tokenOrSymbol === 'number') {
      return this.stocks.get(tokenOrSymbol)
    }
    const token = this.symbolToToken.get(tokenOrSymbol.toUpperCase())
    return token ? this.stocks.get(token) : undefined
  }

  public getAllStocks(): StockScanState[] {
    return Array.from(this.stocks.values())
  }

  public processTick(tick: any): void {
    const token = tick.instrument_token
    if (!token) return

    const state = this.stocks.get(token)
    if (!state) return

    const price = tick.last_price || state.lastPrice
    if (price <= 0) return

    this.updatePriceAndOhlc(state, tick, price)
    this.updateDepth(state, tick)
    this.updateVolumeIfPresent(state, tick.volume_traded)
    this.evaluateTriggers(state)
  }

  public getScreenerSnapshot(limit = 20): {
    topGainers: StockScanState[]
    topSurges: StockScanState[]
    activeCandidates: CandidateAlert[]
  } {
    const list = Array.from(this.stocks.values()).filter((s) => s.lastPrice > 0)
    const topGainers = [...list].sort((a, b) => b.changePct - a.changePct).slice(0, limit)
    const topSurges = [...list].sort((a, b) => b.volumeSurgeRatio - a.volumeSurgeRatio).slice(0, limit)
    const activeCandidates = this.priorityQueue.getItems()

    return { topGainers, topSurges, activeCandidates }
  }

  public resetCooldown(symbol: string): void {
    this.symbolCooldowns.delete(symbol.toUpperCase())
  }

  public clear(): void {
    this.stocks.clear()
    this.symbolToToken.clear()
    this.priorityQueue.clear()
    this.symbolCooldowns.clear()
  }

  private createInitialStockState(token: number, symbol: string, isFnoListed: boolean): StockScanState {
    return {
      token,
      symbol,
      lastPrice: 0,
      open: 0,
      high: 0,
      low: 0,
      close: 0,
      changePct: 0,
      atp: 0,
      volumeTraded: 0,
      lastCumulativeVolume: 0,
      minuteBuckets: [0, 0, 0, 0, 0],
      currentBucketIndex: 0,
      lastBucketMinute: Math.floor(Date.now() / 60000),
      rolling5mAvgVolume: 0,
      volumeSurgeRatio: 1.0,
      obi: 0,
      isFnoListed,
    }
  }

  private updatePriceAndOhlc(state: StockScanState, tick: any, price: number): void {
    state.lastPrice = price
    if (tick.average_traded_price) state.atp = tick.average_traded_price

    if (tick.ohlc) {
      state.open = tick.ohlc.open || state.open
      state.high = Math.max(state.high, tick.ohlc.high || price, price)
      state.low = state.low > 0 ? Math.min(state.low, tick.ohlc.low || price, price) : tick.ohlc.low || price
      state.close = tick.ohlc.close || state.close
    }

    state.changePct = state.close > 0 ? ((price - state.close) / state.close) * 100 : tick.change ?? state.changePct
  }

  private updateDepth(state: StockScanState, tick: any): void {
    if (!tick.depth?.buy || !tick.depth?.sell) return
    state.obi = this.calculateOBI(tick.depth.buy, tick.depth.sell)
  }

  private calculateOBI(buyDepth: any[], sellDepth: any[]): number {
    const totalBid = buyDepth.reduce((acc, level) => acc + (level.quantity || 0), 0)
    const totalAsk = sellDepth.reduce((acc, level) => acc + (level.quantity || 0), 0)
    const sum = totalBid + totalAsk
    return sum === 0 ? 0 : parseFloat(((totalBid - totalAsk) / sum).toFixed(3))
  }

  private updateVolumeIfPresent(state: StockScanState, currentCumVol?: number): void {
    if (!currentCumVol || currentCumVol <= 0) return
    this.updateRollingVolume(state, currentCumVol)
  }

  private updateRollingVolume(state: StockScanState, currentCumVol: number): void {
    if (state.lastCumulativeVolume === 0) {
      state.lastCumulativeVolume = currentCumVol
      state.volumeTraded = currentCumVol
      return
    }

    const deltaVolume = Math.max(0, currentCumVol - state.lastCumulativeVolume)
    state.lastCumulativeVolume = currentCumVol
    state.volumeTraded = currentCumVol

    this.advanceMinuteBuckets(state)
    state.minuteBuckets[state.currentBucketIndex] =
      (state.minuteBuckets[state.currentBucketIndex] || 0) + deltaVolume

    this.calculateVolumeSurgeRatio(state)
  }

  private advanceMinuteBuckets(state: StockScanState): void {
    const currentMinute = Math.floor(Date.now() / 60000)
    if (currentMinute <= state.lastBucketMinute) return

    const minutesPassed = Math.min(5, currentMinute - state.lastBucketMinute)
    Array.from({ length: minutesPassed }).forEach(() => {
      state.currentBucketIndex = (state.currentBucketIndex + 1) % 5
      state.minuteBuckets[state.currentBucketIndex] = 0
    })
    state.lastBucketMinute = currentMinute
  }

  private calculateVolumeSurgeRatio(state: StockScanState): void {
    const sum5m = state.minuteBuckets.reduce((acc, val) => acc + (val || 0), 0)
    state.rolling5mAvgVolume = sum5m / 5

    const current1mRate = state.minuteBuckets[state.currentBucketIndex] || 0
    state.volumeSurgeRatio =
      state.rolling5mAvgVolume > 500
        ? parseFloat((current1mRate / (state.rolling5mAvgVolume || 1)).toFixed(2))
        : 1.0
  }

  private evaluateTriggers(state: StockScanState): void {
    if (state.lastPrice < this.minPrice) return
    if (this.isSymbolOnCooldown(state.symbol)) return

    const isSurging = state.volumeSurgeRatio >= this.surgeThreshold
    const isNearDayHigh = state.high > 0 && state.lastPrice >= state.high * 0.998
    const isAboveVwap = state.atp > 0 ? state.lastPrice >= state.atp : true

    if (!isSurging || !isNearDayHigh || !isAboveVwap) return

    this.triggerCandidateAlert(state)
  }

  private isSymbolOnCooldown(symbol: string): boolean {
    const lastCooldown = this.symbolCooldowns.get(symbol) ?? 0
    return Date.now() - lastCooldown < this.cooldownMs
  }

  private triggerCandidateAlert(state: StockScanState): void {
    const now = Date.now()
    const priorityScore = this.calculatePriorityScore(state)

    const alert: CandidateAlert = {
      id: `cand_${state.symbol}_${now}`,
      token: state.token,
      symbol: state.symbol,
      price: state.lastPrice,
      dayHigh: state.high,
      atp: state.atp,
      volumeSurgeRatio: state.volumeSurgeRatio,
      changePct: state.changePct,
      obi: state.obi,
      priorityScore,
      timestamp: now,
      expiresAt: now + 45000,
      isFnoListed: state.isFnoListed,
    }

    const pushed = this.priorityQueue.push(alert)
    if (!pushed) return

    state.lastSurgeAt = now
    this.symbolCooldowns.set(state.symbol, now)
    this.emit('candidate_surfaced', alert)
  }

  private calculatePriorityScore(state: StockScanState): number {
    const dayHighProximity = state.high > 0 ? Math.min(1.0, state.lastPrice / state.high) : 1.0
    return parseFloat(
      (
        state.volumeSurgeRatio * 0.5 +
        Math.max(0, state.changePct) * 0.3 +
        (state.obi + 1) * 0.2 +
        dayHighProximity * 0.5
      ).toFixed(2)
    )
  }
}

export const globalKiteScanner = new KiteScanner()
