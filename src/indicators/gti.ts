import type { Candle, GTIScore, GTIClassification, GTICandleData } from "../types/analysis.js"

// ─── Volume Anomaly ─────────────────────────────────────────────────────────
// Z-score of current volume vs recent volumes, signed by price direction.
// Positive = bullish volume spike, negative = bearish volume spike.
export function computeVolumeAnomaly(
  volumes: number[],
  currentVolume: number,
  priceDirection: number,
): number {
  if (volumes.length === 0) return 0

  const mean = volumes.reduce((a, b) => a + b, 0) / volumes.length
  const variance = volumes.reduce((sum, v) => sum + (v - mean) ** 2, 0) / volumes.length
  const stdDev = Math.sqrt(variance)

  if (stdDev === 0) return 0

  const zScore = (currentVolume - mean) / stdDev
  const signed = zScore * priceDirection
  return Math.tanh(signed / 3)
}

// ─── Cumulative Volume Delta ────────────────────────────────────────────────
// Net buy/sell pressure normalized to [-1, 1].
export function computeCVD(buyVolume: number, sellVolume: number): number {
  const total = buyVolume + sellVolume
  if (total === 0) return 0

  const net = buyVolume - sellVolume
  return Math.tanh((net / total) * 2)
}

// ─── VWAP Deviation ─────────────────────────────────────────────────────────
// Institutional accumulation/distribution signal from VWAP position.
// Price BELOW VWAP → positive (institutions buying = accumulation).
// Price ABOVE VWAP → negative (institutions selling = distribution).
export function computeVwapDeviation(price: number, vwap: number, atr: number): number {
  if (atr === 0) return 0

  const deviation = (price - vwap) / atr
  return Math.tanh(-deviation)
}

// ─── Open Interest Signal ───────────────────────────────────────────────────
// Maps options analysis market flow states to a directional score.
export function computeOiSignal(marketFlow: string): number {
  const flowMap: Record<string, number> = {
    LONG_BUILDUP: 1.0,
    SHORT_COVERING: 0.5,
    NEUTRAL: 0,
    LONG_UNWINDING: -0.5,
    SHORT_BUILDUP: -1.0,
  }
  return flowMap[marketFlow] ?? 0
}

// ─── Smart Money Flow ───────────────────────────────────────────────────────
// Session-timing weighted directional flow. IST session windows determine
// how much weight institutional activity gets during that period.
export function computeSmartMoneyFlow(
  hour: number,
  minute: number,
  volumeWeightedDirection: number,
): number {
  const timeInMinutes = hour * 60 + minute

  let weight: number
  if (timeInMinutes >= 555 && timeInMinutes <= 585) {
    // 9:15 - 9:45 IST (opening auction / institutional positioning)
    weight = 1.5
  } else if (timeInMinutes >= 870 && timeInMinutes <= 930) {
    // 14:30 - 15:30 IST (closing session / institutional rebalancing)
    weight = 1.5
  } else if (timeInMinutes >= 660 && timeInMinutes <= 840) {
    // 11:00 - 14:00 IST (lunch / chop zone)
    weight = 0.5
  } else {
    weight = 1.0
  }

  const raw = volumeWeightedDirection * weight
  return Math.max(-1, Math.min(1, raw))
}

// ─── Component Weights ──────────────────────────────────────────────────────
const WEIGHTS = {
  volumeAnomaly: 0.3,
  cvd: 0.25,
  vwapDeviation: 0.2,
  oiSignal: 0.15,
  smartMoneyFlow: 0.1,
} as const

// ─── Composite GTI Score ────────────────────────────────────────────────────
// Weighted average of all components with classification and confidence.
export function computeGTIScore(components: GTIScore["components"]): GTIScore {
  const composite =
    components.volumeAnomaly * WEIGHTS.volumeAnomaly +
    components.cvd * WEIGHTS.cvd +
    components.vwapDeviation * WEIGHTS.vwapDeviation +
    components.oiSignal * WEIGHTS.oiSignal +
    components.smartMoneyFlow * WEIGHTS.smartMoneyFlow

  // Classification thresholds
  let classification: GTIClassification
  if (composite > 0.6) {
    classification = "STRONG_INSTITUTIONAL_BUY"
  } else if (composite > 0.2) {
    classification = "INSTITUTIONAL_BUY"
  } else if (composite > -0.2) {
    classification = "NEUTRAL"
  } else if (composite > -0.6) {
    classification = "INSTITUTIONAL_SELL"
  } else {
    classification = "STRONG_INSTITUTIONAL_SELL"
  }

  // Confidence: proportion of components that agree with composite direction
  const componentValues = [
    components.volumeAnomaly,
    components.cvd,
    components.vwapDeviation,
    components.oiSignal,
    components.smartMoneyFlow,
  ]
  const compositeSign = Math.sign(composite)
  const agreeing = componentValues.filter((v) => Math.sign(v) === compositeSign || v === 0).length
  const confidence = (agreeing / 5) * 100

  return { composite, components, classification, confidence }
}

// ─── Historical GTI (Retroactive from OHLCV) ───────────────────────────────
// Computes GTI scores for historical candles when no tick-level data is available.
// Buy/sell volume is approximated from candle shape (close-low / high-low split).
export function computeHistoricalGTI(
  candles: Candle[],
  vwap: number,
  atr: number,
  marketFlow?: string,
): GTICandleData[] {
  const results: GTICandleData[] = []
  const flow = marketFlow ?? "NEUTRAL"

  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i]!
    const priceDirection = candle.close >= candle.open ? 1 : -1

    // Rolling 20-candle volume window (up to current candle, exclusive)
    const windowStart = Math.max(0, i - 20)
    const recentVolumes = candles.slice(windowStart, i).map((c) => c.volume)

    const volumeAnomaly = computeVolumeAnomaly(recentVolumes, candle.volume, priceDirection)

    // Approximate buy/sell volume from candle shape
    const range = candle.high - candle.low
    let buyVol: number
    let sellVol: number
    if (range === 0) {
      buyVol = candle.volume * 0.5
      sellVol = candle.volume * 0.5
    } else {
      buyVol = candle.volume * ((candle.close - candle.low) / range)
      sellVol = candle.volume * ((candle.high - candle.close) / range)
    }
    const cvd = computeCVD(buyVol, sellVol)

    const vwapDeviation = computeVwapDeviation(candle.close, vwap, atr)
    const oiSignal = computeOiSignal(flow)

    // IST time from Unix seconds
    const istDate = new Date(candle.time * 1000)
    const utcH = istDate.getUTCHours()
    const utcM = istDate.getUTCMinutes()
    const totalIstMinutes = utcH * 60 + utcM + 330 // +5:30
    const istHour = Math.floor(totalIstMinutes / 60) % 24
    const istMinute = totalIstMinutes % 60

    // Volume-weighted direction
    const avgVol =
      recentVolumes.length > 0
        ? recentVolumes.reduce((a, b) => a + b, 0) / recentVolumes.length
        : 1
    const volWeightedDir = priceDirection * Math.min(candle.volume / Math.max(avgVol, 1), 2)
    const smartMoneyFlow = computeSmartMoneyFlow(istHour, istMinute, volWeightedDir)

    const gtiScore = computeGTIScore({ volumeAnomaly, cvd, vwapDeviation, oiSignal, smartMoneyFlow })

    results.push({
      time: candle.time,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
      gtiScore,
    })
  }

  return results
}
