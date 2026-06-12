import type { Candle, GTIScore, GTICandleData } from "../types/analysis.js"
import type { LiveTick } from "../analysis/live.js"
import {
  computeGTIScore,
  computeVolumeAnomaly,
  computeCVD,
  computeVwapDeviation,
  computeOiSignal,
  computeSmartMoneyFlow,
} from "./gti.js"

/**
 * Stateful GTI tracker that accumulates tick data and computes live GTI scores
 * per instrument token. Call `addTick()` on every incoming tick, then
 * `onCandleClose()` when a candle finalizes to get the GTI score for that bar.
 */
export class GTITracker {
  // Per-token accumulated buy volume for the current (open) candle
  private buyVolume: Map<number, number> = new Map()
  // Per-token accumulated sell volume for the current (open) candle
  private sellVolume: Map<number, number> = new Map()
  // Last tick seen per token (for uptick/downtick classification)
  private previousTick: Map<number, LiveTick> = new Map()
  // Rolling 20-candle volume history per token
  private recentVolumes: Map<number, number[]> = new Map()
  // Full GTI candle history per token (capped at 500)
  private candleGTIHistory: Map<number, GTICandleData[]> = new Map()
  // Current market context per token
  private currentVwap: Map<number, number> = new Map()
  private currentAtr: Map<number, number> = new Map()
  private currentMarketFlow: string = "NEUTRAL"

  /**
   * Update the market context used for VWAP deviation and OI signal components.
   * Call this whenever a new analysis cycle produces fresh VWAP / ATR values.
   */
  setMarketContext(token: number, vwap: number, atr: number, marketFlow?: string): void {
    this.currentVwap.set(token, vwap)
    this.currentAtr.set(token, atr)
    if (marketFlow) this.currentMarketFlow = marketFlow
  }

  /**
   * Ingest a live tick. Incremental volume is classified as buy or sell based
   * on whether the price moved up or down from the previous tick.
   */
  addTick(tick: LiveTick): void {
    const token = tick.instrument_token
    if (!token) return

    const prev = this.previousTick.get(token)
    const volume = tick.volume_traded || 0

    if (prev) {
      // Approximate buy/sell volume from tick direction
      const prevVol = prev.volume_traded || 0
      const tickVol = Math.max(0, volume - prevVol)

      if (tick.last_price >= prev.last_price) {
        this.buyVolume.set(token, (this.buyVolume.get(token) || 0) + tickVol)
      } else {
        this.sellVolume.set(token, (this.sellVolume.get(token) || 0) + tickVol)
      }
    }

    this.previousTick.set(token, tick)
  }

  /**
   * Called when a candle closes. Computes the GTI score using accumulated tick
   * data and the pure scoring functions, stores it in history, and resets the
   * buy/sell accumulators for the next candle.
   */
  onCandleClose(token: number, candle: Candle): GTIScore {
    // Get accumulated buy/sell volumes
    const buyVol = this.buyVolume.get(token) || 0
    const sellVol = this.sellVolume.get(token) || 0

    // Update rolling volumes
    const volumes = this.recentVolumes.get(token) || []
    volumes.push(candle.volume)
    if (volumes.length > 20) volumes.shift()
    this.recentVolumes.set(token, volumes)

    // Compute all components
    const priceDirection = candle.close >= candle.open ? 1 : -1
    const volumeAnomaly = computeVolumeAnomaly(volumes, candle.volume, priceDirection)
    const cvd = computeCVD(buyVol, sellVol)
    const vwapDeviation = computeVwapDeviation(
      candle.close,
      this.currentVwap.get(token) || 0,
      this.currentAtr.get(token) || 1,
    )
    const oiSignal = computeOiSignal(this.currentMarketFlow)

    // Get IST time from candle Unix timestamp
    const utcDate = new Date(candle.time * 1000)
    const utcH = utcDate.getUTCHours()
    const utcM = utcDate.getUTCMinutes()
    const totalIstMinutes = utcH * 60 + utcM + 330 // +5:30
    const istHour = Math.floor(totalIstMinutes / 60) % 24
    const istMinute = totalIstMinutes % 60

    // Volume-weighted direction for smart money flow
    const avgVol = volumes.length > 0 ? volumes.reduce((a, b) => a + b, 0) / volumes.length : 1
    const volWeightedDir = priceDirection * Math.min(candle.volume / Math.max(avgVol, 1), 2)
    const smartMoneyFlow = computeSmartMoneyFlow(istHour, istMinute, volWeightedDir)

    const gtiScore = computeGTIScore({
      volumeAnomaly,
      cvd,
      vwapDeviation,
      oiSignal,
      smartMoneyFlow,
    })

    // Store in history
    const history = this.candleGTIHistory.get(token) || []
    history.push({
      time: candle.time,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
      gtiScore,
    })
    if (history.length > 500) history.shift()
    this.candleGTIHistory.set(token, history)

    // Reset accumulators for next candle
    this.buyVolume.set(token, 0)
    this.sellVolume.set(token, 0)

    return gtiScore
  }

  /** Return the most recent finalized GTI score, or a neutral default. */
  getCurrentScore(token: number): GTIScore {
    const history = this.candleGTIHistory.get(token)
    if (history && history.length > 0) {
      return history[history.length - 1]!.gtiScore
    }
    return {
      composite: 0,
      components: {
        volumeAnomaly: 0,
        cvd: 0,
        vwapDeviation: 0,
        oiSignal: 0,
        smartMoneyFlow: 0,
      },
      classification: "NEUTRAL",
      confidence: 0,
    }
  }

  /** Return full GTI candle history for a token. */
  getHistory(token: number): GTICandleData[] {
    return this.candleGTIHistory.get(token) || []
  }
}

export const gtiTracker = new GTITracker()
