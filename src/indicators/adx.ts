import type { Candle } from '../types/analysis.js'

export interface ADXResult {
  adx: number
  plusDI: number
  minusDI: number
}

/**
 * Calculates the Average Directional Index (ADX) and Directional Indicators (+DI, -DI).
 * Follows J. Welles Wilder's original smoothing formulas.
 */
export function calculateADX(candles: Candle[], period: number = 14): ADXResult {
  if (candles.length < period * 2) {
    return { adx: 0, plusDI: 0, minusDI: 0 }
  }

  const trs: number[] = []
  const plusDMs: number[] = []
  const minusDMs: number[] = []

  for (let i = 1; i < candles.length; i++) {
    const current = candles[i]!
    const prev = candles[i - 1]!

    // 1. True Range (TR)
    const tr = Math.max(
      current.high - current.low,
      Math.abs(current.high - prev.close),
      Math.abs(current.low - prev.close)
    )
    trs.push(tr)

    // 2. Directional Movement (+DM, -DM)
    const upMove = current.high - prev.high
    const downMove = prev.low - current.low

    let plusDM = 0
    let minusDM = 0

    if (upMove > downMove && upMove > 0) {
      plusDM = upMove
    }
    if (downMove > upMove && downMove > 0) {
      minusDM = downMove
    }

    plusDMs.push(plusDM)
    minusDMs.push(minusDM)
  }

  // 3. Wilder's Initial Accumulation
  let smoothedTR = trs.slice(0, period).reduce((a, b) => a + b, 0)
  let smoothedPlusDM = plusDMs.slice(0, period).reduce((a, b) => a + b, 0)
  let smoothedMinusDM = minusDMs.slice(0, period).reduce((a, b) => a + b, 0)

  const dxValues: number[] = []

  const calculateDX = (tr: number, pDM: number, mDM: number) => {
    if (tr === 0) return 0
    const plusDI = 100 * (pDM / tr)
    const minusDI = 100 * (mDM / tr)
    const sum = plusDI + minusDI
    if (sum === 0) return 0
    return { plusDI, minusDI, dx: 100 * (Math.abs(plusDI - minusDI) / sum) }
  }

  // Compute first DX point
  const initial = calculateDX(smoothedTR, smoothedPlusDM, smoothedMinusDM)
  let lastPlusDI = 0
  let lastMinusDI = 0

  if (typeof initial === 'object') {
    dxValues.push(initial.dx)
    lastPlusDI = initial.plusDI
    lastMinusDI = initial.minusDI
  } else {
    dxValues.push(0)
  }

  // 4. Wilder's Smoothing Iteration
  for (let i = period; i < trs.length; i++) {
    smoothedTR = smoothedTR - smoothedTR / period + trs[i]!
    smoothedPlusDM = smoothedPlusDM - smoothedPlusDM / period + plusDMs[i]!
    smoothedMinusDM = smoothedMinusDM - smoothedMinusDM / period + minusDMs[i]!

    const currentDX = calculateDX(smoothedTR, smoothedPlusDM, smoothedMinusDM)
    if (typeof currentDX === 'object') {
      dxValues.push(currentDX.dx)
      lastPlusDI = currentDX.plusDI
      lastMinusDI = currentDX.minusDI
    } else {
      dxValues.push(0)
    }
  }

  // 5. Calculate ADX (Wilder's smoothed DX)
  if (dxValues.length < period) {
    return { adx: 0, plusDI: lastPlusDI, minusDI: lastMinusDI }
  }

  let adx = dxValues.slice(0, period).reduce((a, b) => a + b, 0) / period
  for (let i = period; i < dxValues.length; i++) {
    adx = (adx * (period - 1) + dxValues[i]!) / period
  }

  return { adx, plusDI: lastPlusDI, minusDI: lastMinusDI }
}
