import type { Candle, GTICandleData, GTIScore } from '../types/analysis.js'

export interface GtiMarketFlowContext {
  sentiment?: 'bullish' | 'bearish' | 'neutral' | undefined
  marketFlow?: 'SHORT_COVERING' | 'LONG_BUILDUP' | 'SHORT_BUILDUP' | 'LONG_UNWINDING' | 'NEUTRAL' | undefined
  pcr?: number | undefined
}

interface TokenGtiState {
  vwap: number
  atr: number
  flow: GtiMarketFlowContext
  recentCandles: Candle[]
  tickVolumes: { price: number; volume: number; delta: number }[]
  history: GTICandleData[]
  lastScore: GTIScore
}

const DEFAULT_GTI_SCORE: GTIScore = {
  composite: 0,
  classification: 'NEUTRAL',
  confidence: 0,
  components: {
    volumeAnomaly: 0,
    cvd: 0,
    vwapDeviation: 0,
    oiSignal: 0,
    smartMoneyFlow: 0,
  },
}

export class GTITracker {
  private readonly states = new Map<number, TokenGtiState>()

  public setMarketContext(token: number, vwap: number, atr: number, flow: GtiMarketFlowContext): void {
    const existing = this.getOrCreateState(token)
    this.states.set(token, {
      ...existing,
      vwap,
      atr: Math.max(1, atr),
      flow,
    })
  }

  public computeFromCandles(
    token: number,
    candles: Candle[],
    vwap: number,
    atr: number,
    flow: GtiMarketFlowContext
  ): GTIScore {
    this.setMarketContext(token, vwap, atr, flow)
    if (candles.length === 0) return this.getCurrentScore(token)

    const recentCandles = candles.slice(-20)
    const lastCandle = recentCandles[recentCandles.length - 1]!
    const state = this.getOrCreateState(token)
    const updatedState: TokenGtiState = {
      ...state,
      recentCandles,
    }
    const score = this.calculateScoreFromState(updatedState, lastCandle)
    const historyEntry: GTICandleData = { candle: lastCandle, gtiScore: score }
    this.states.set(token, {
      ...updatedState,
      lastScore: score,
      history: [...updatedState.history.slice(-49), historyEntry],
    })
    return score
  }

  public getCurrentScore(token: number): GTIScore {
    if (token === 0 && this.states.size > 0) {
      const firstState = Array.from(this.states.values())[0]
      return firstState ? firstState.lastScore : DEFAULT_GTI_SCORE
    }
    return this.states.get(token)?.lastScore ?? DEFAULT_GTI_SCORE
  }

  public getHistory(token: number): GTICandleData[] {
    if (token === 0 && this.states.size > 0) {
      const firstState = Array.from(this.states.values())[0]
      return firstState ? firstState.history : []
    }
    return this.states.get(token)?.history ?? []
  }

  public onCandleClose(token: number, candle: Candle): GTIScore {
    const state = this.getOrCreateState(token)
    const recentCandles = [...state.recentCandles.slice(-19), candle]
    const nextState: TokenGtiState = { ...state, recentCandles }
    const score = this.calculateScoreFromState(nextState, candle)
    const historyEntry: GTICandleData = { candle, gtiScore: score }
    this.states.set(token, {
      ...nextState,
      tickVolumes: [],
      lastScore: score,
      history: [...nextState.history.slice(-49), historyEntry],
    })
    return score
  }

  public addTick(tick: { instrument_token?: number; last_price?: number; volume_traded?: number }): void {
    const token = tick.instrument_token
    const price = tick.last_price
    if (!token || !price) return

    const state = this.getOrCreateState(token)
    const prevTick = state.tickVolumes[state.tickVolumes.length - 1]
    const priceDiff = prevTick ? price - prevTick.price : 0
    const volume = tick.volume_traded ?? 1
    const delta = priceDiff > 0 ? volume : priceDiff < 0 ? -volume : 0

    this.states.set(token, {
      ...state,
      tickVolumes: [...state.tickVolumes.slice(-99), { price, volume, delta }],
    })
  }

  private getOrCreateState(token: number): TokenGtiState {
    const existing = this.states.get(token)
    if (existing) return existing
    const initial: TokenGtiState = {
      vwap: 0,
      atr: 20,
      flow: {},
      recentCandles: [],
      tickVolumes: [],
      history: [],
      lastScore: DEFAULT_GTI_SCORE,
    }
    this.states.set(token, initial)
    return initial
  }

  private calculateScoreFromState(state: TokenGtiState, lastCandle: Candle): GTIScore {
    const volumeAnomaly = this.computeVolumeAnomaly(state.recentCandles, lastCandle)
    const cvd = this.computeCvdScore(state.recentCandles, state.tickVolumes)
    const vwapDeviation = this.computeDirectionalVwapDeviation(lastCandle.close, state.vwap, state.atr)
    const oiSignal = this.computeOiSignal(state.flow)
    const smartMoneyFlow = this.computeSmartMoneyFlow(lastCandle, volumeAnomaly, oiSignal)

    const compositeRaw = 0.2 * volumeAnomaly + 0.25 * cvd + 0.2 * vwapDeviation + 0.2 * oiSignal + 0.15 * smartMoneyFlow
    const composite = Math.max(-1, Math.min(1, Number(compositeRaw.toFixed(4))))
    const confidence = this.computeConfidence(state.recentCandles.length, state.flow)

    return {
      composite,
      classification: this.classifyComposite(composite),
      confidence,
      components: {
        volumeAnomaly: Number(volumeAnomaly.toFixed(4)),
        cvd: Number(cvd.toFixed(4)),
        vwapDeviation: Number(vwapDeviation.toFixed(4)),
        oiSignal: Number(oiSignal.toFixed(4)),
        smartMoneyFlow: Number(smartMoneyFlow.toFixed(4)),
      },
    }
  }

  private computeVolumeAnomaly(candles: Candle[], lastCandle: Candle): number {
    if (candles.length < 2) return 0
    const prior = candles.slice(0, -1)
    const avgVol = prior.reduce((sum, c) => sum + c.volume, 0) / prior.length
    if (avgVol <= 0) return 0
    const ratio = (lastCandle.volume - avgVol) / avgVol
    const direction = lastCandle.close >= lastCandle.open ? 1 : -1
    return Math.tanh(ratio) * direction
  }

  private computeCvdScore(candles: Candle[], ticks: { price: number; volume: number; delta: number }[]): number {
    if (ticks.length >= 5) {
      const totalVol = ticks.reduce((sum, t) => sum + Math.abs(t.volume), 0)
      const netDelta = ticks.reduce((sum, t) => sum + t.delta, 0)
      return totalVol > 0 ? Math.tanh((netDelta / totalVol) * 2) : 0
    }
    if (candles.length === 0) return 0
    const candleDeltas = candles.map((c) => {
      const range = Math.max(0.01, c.high - c.low)
      const bodyRatio = (c.close - c.open) / range
      return bodyRatio * Math.max(1, c.volume)
    })
    const totalVol = candles.reduce((sum, c) => sum + Math.max(1, c.volume), 0)
    const netCandleDelta = candleDeltas.reduce((sum, d) => sum + d, 0)
    return totalVol > 0 ? Math.tanh((netCandleDelta / totalVol) * 2.5) : 0
  }

  private computeDirectionalVwapDeviation(price: number, vwap: number, atr: number): number {
    if (vwap <= 0 || atr <= 0) return 0
    return Math.tanh((price - vwap) / (2 * atr))
  }

  private computeOiSignal(flow: GtiMarketFlowContext): number {
    const flowMap: Record<string, number> = {
      SHORT_COVERING: 0.85,
      LONG_BUILDUP: 0.65,
      SHORT_BUILDUP: -0.65,
      LONG_UNWINDING: -0.85,
      NEUTRAL: 0,
    }
    const flowBase = flow.marketFlow ? (flowMap[flow.marketFlow] ?? 0) : 0
    const sentimentAdjust = flow.sentiment === 'bullish' ? 0.25 : flow.sentiment === 'bearish' ? -0.25 : 0
    return Math.max(-1, Math.min(1, flowBase + sentimentAdjust))
  }

  private computeSmartMoneyFlow(lastCandle: Candle, volumeAnomaly: number, oiSignal: number): number {
    const range = Math.max(0.01, lastCandle.high - lastCandle.low)
    const closeLocation = (lastCandle.close - lastCandle.low) / range - 0.5
    return Math.tanh(closeLocation * 1.5 + 0.5 * volumeAnomaly + 0.5 * oiSignal)
  }

  private computeConfidence(candleCount: number, flow: GtiMarketFlowContext): number {
    const sampleConf = Math.min(70, candleCount * 7)
    const flowBonus = flow.marketFlow && flow.marketFlow !== 'NEUTRAL' ? 20 : flow.sentiment ? 10 : 0
    return Math.min(100, sampleConf + flowBonus)
  }

  private classifyComposite(composite: number): string {
    if (composite >= 0.6) return 'STRONG_BULLISH_FLOW'
    if (composite >= 0.25) return 'BULLISH_ACCUMULATION'
    if (composite <= -0.6) return 'STRONG_BEARISH_FLOW'
    if (composite <= -0.25) return 'BEARISH_DISTRIBUTION'
    return 'NEUTRAL'
  }
}

export const gtiTracker = new GTITracker()
