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

  const movements = candles.slice(1).map((current, idx) => {
    const prev = candles[idx]!
    const tr = Math.max(
      current.high - current.low,
      Math.abs(current.high - prev.close),
      Math.abs(current.low - prev.close)
    )

    const upMove = current.high - prev.high
    const downMove = prev.low - current.low

    const plusDM = upMove > downMove && upMove > 0 ? upMove : 0
    const minusDM = downMove > upMove && downMove > 0 ? downMove : 0

    return { tr, plusDM, minusDM }
  })

  const trs = movements.map((m) => m.tr)
  const plusDMs = movements.map((m) => m.plusDM)
  const minusDMs = movements.map((m) => m.minusDM)

  const initialTR = trs.slice(0, period).reduce((a, b) => a + b, 0)
  const initialPlusDM = plusDMs.slice(0, period).reduce((a, b) => a + b, 0)
  const initialMinusDM = minusDMs.slice(0, period).reduce((a, b) => a + b, 0)

  const calculateDX = (tr: number, pDM: number, mDM: number) => {
    if (tr === 0) return 0
    const plusDI = 100 * (pDM / tr)
    const minusDI = 100 * (mDM / tr)
    const sum = plusDI + minusDI
    if (sum === 0) return 0
    return { plusDI, minusDI, dx: 100 * (Math.abs(plusDI - minusDI) / sum) }
  }

  const initialDXRes = calculateDX(initialTR, initialPlusDM, initialMinusDM)
  const initialDX = typeof initialDXRes === 'object' ? initialDXRes.dx : 0
  const initialPlusDI = typeof initialDXRes === 'object' ? initialDXRes.plusDI : 0
  const initialMinusDI = typeof initialDXRes === 'object' ? initialDXRes.minusDI : 0

  const { dxValues, lastPlusDI, lastMinusDI } = trs.slice(period).reduce(
    (acc, tr, idx) => {
      const i = period + idx
      const smoothedTR = acc.smoothedTR - acc.smoothedTR / period + tr
      const smoothedPlusDM = acc.smoothedPlusDM - acc.smoothedPlusDM / period + plusDMs[i]!
      const smoothedMinusDM = acc.smoothedMinusDM - acc.smoothedMinusDM / period + minusDMs[i]!

      const currentDX = calculateDX(smoothedTR, smoothedPlusDM, smoothedMinusDM)
      const dx = typeof currentDX === 'object' ? currentDX.dx : 0
      const plusDI = typeof currentDX === 'object' ? currentDX.plusDI : acc.lastPlusDI
      const minusDI = typeof currentDX === 'object' ? currentDX.minusDI : acc.lastMinusDI

      return {
        smoothedTR,
        smoothedPlusDM,
        smoothedMinusDM,
        dxValues: [...acc.dxValues, dx],
        lastPlusDI: plusDI,
        lastMinusDI: minusDI,
      }
    },
    {
      smoothedTR: initialTR,
      smoothedPlusDM: initialPlusDM,
      smoothedMinusDM: initialMinusDM,
      dxValues: [initialDX],
      lastPlusDI: initialPlusDI,
      lastMinusDI: initialMinusDI,
    }
  )

  if (dxValues.length < period) {
    return { adx: 0, plusDI: lastPlusDI, minusDI: lastMinusDI }
  }

  const initialADX = dxValues.slice(0, period).reduce((a, b) => a + b, 0) / period
  const adx = dxValues.slice(period).reduce((acc, dx) => (acc * (period - 1) + dx) / period, initialADX)

  return { adx, plusDI: lastPlusDI, minusDI: lastMinusDI }
}
