import type { SwingPoint, WaveContext } from '../types/analysis.js'

/**
 * Deterministically detects the current Elliott Wave phase based on swing points.
 * Distinguishes bullish impulse/pullback structure from bearish impulse/pullback structure
 * using swing progression (HH/HL vs LH/LL) and projects mathematical Wave 5 Fibonacci extensions.
 */
function getBearishPhase(
  currentPrice: number,
  lastLowPrice: number,
  fib382: number,
  fib618: number,
  wave5Target: number
): WaveContext['currentPhase'] {
  if (currentPrice <= wave5Target) return 'WAVE_5'
  if (currentPrice < lastLowPrice) return 'WAVE_3'
  if (currentPrice >= lastLowPrice && currentPrice <= fib382) return 'WAVE_4'
  if (currentPrice > fib382 && currentPrice <= fib618) return 'WAVE_2'
  return 'ABC_CORRECTION'
}

function getBullishPhase(
  currentPrice: number,
  lastHighPrice: number,
  fib382: number,
  fib618: number,
  wave5Target: number
): WaveContext['currentPhase'] {
  if (currentPrice >= wave5Target) return 'WAVE_5'
  if (currentPrice > lastHighPrice) return 'WAVE_3'
  if (currentPrice <= lastHighPrice && currentPrice >= fib382) return 'WAVE_4'
  if (currentPrice < fib382 && currentPrice >= fib618) return 'WAVE_2'
  return 'CONSOLIDATION'
}

function resolveIsBearishSequence(
  lows: SwingPoint[],
  highs: SwingPoint[],
  lastLow: SwingPoint,
  lastHigh: SwingPoint,
  currentPrice: number
): boolean {
  if (currentPrice < lastLow.price) return true
  if (currentPrice > lastHigh.price) return false

  const prevLow = lows.length >= 2 ? lows[lows.length - 2] : undefined
  const prevHigh = highs.length >= 2 ? highs[highs.length - 2] : undefined

  // Higher High + Higher Low progression is a bullish structure even when the latest swing was a pullback LOW
  if (prevLow && prevHigh) {
    if (lastHigh.price > prevHigh.price && lastLow.price >= prevLow.price) return false
    if (lastHigh.price <= prevHigh.price && lastLow.price < prevLow.price) return true
  }

  const fib618Bullish = lastHigh.price - Math.abs(lastHigh.price - lastLow.price) * 0.618
  return lastHigh.time < lastLow.time && currentPrice < fib618Bullish
}

export function detectWaveStructure(swings: SwingPoint[], currentPrice: number): WaveContext {
  if (swings.length < 2) return { currentPhase: 'CONSOLIDATION' }

  const recentSwings = swings.slice(-10)
  const lows = recentSwings.filter((s) => s.type === 'LOW')
  const highs = recentSwings.filter((s) => s.type === 'HIGH')
  const lastLow = lows[lows.length - 1]
  const lastHigh = highs[highs.length - 1]

  if (!lastLow || !lastHigh) return { currentPhase: 'CONSOLIDATION' }

  const fibRange = Math.abs(lastHigh.price - lastLow.price)
  if (fibRange <= 0) return { currentPhase: 'CONSOLIDATION' }

  const isBearishSequence = resolveIsBearishSequence(lows, highs, lastLow, lastHigh, currentPrice)

  if (isBearishSequence) {
    const fibZones = {
      fib382: Number((lastLow.price + fibRange * 0.382).toFixed(2)),
      fib500: Number((lastLow.price + fibRange * 0.5).toFixed(2)),
      fib618: Number((lastLow.price + fibRange * 0.618).toFixed(2)),
    }
    const wave5Target = Math.max(0, Number((lastLow.price - fibRange * 0.618).toFixed(2)))
    return {
      wave1Low: lastLow.price,
      wave1High: lastHigh.price,
      fibZones,
      currentPhase: getBearishPhase(currentPrice, lastLow.price, fibZones.fib382, fibZones.fib618, wave5Target),
      wave5Target,
    }
  }

  const fibZones = {
    fib382: Number((lastHigh.price - fibRange * 0.382).toFixed(2)),
    fib500: Number((lastHigh.price - fibRange * 0.5).toFixed(2)),
    fib618: Number((lastHigh.price - fibRange * 0.618).toFixed(2)),
  }
  const wave5Target = Number((lastHigh.price + fibRange * 0.618).toFixed(2))

  return {
    wave1Low: lastLow.price,
    wave1High: lastHigh.price,
    fibZones,
    currentPhase: getBullishPhase(currentPrice, lastHigh.price, fibZones.fib382, fibZones.fib618, wave5Target),
    wave5Target,
  }
}
