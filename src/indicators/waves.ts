import type { SwingPoint, WaveContext } from '../types/analysis.js'

/**
 * Deterministically detects the current Elliott Wave phase based on swing points.
 * This is a simplified model focusing on an impulse sequence (1-2-3-4-5).
 */
export function detectWaveStructure(swings: SwingPoint[], currentPrice: number): WaveContext {
  const context: WaveContext = { currentPhase: 'CONSOLIDATION' }
  if (swings.length < 2) return context

  const recentSwings = swings.slice(-10)
  const lastLow = recentSwings.filter((s) => s.type === 'LOW').pop()
  const lastHigh = recentSwings.filter((s) => s.type === 'HIGH').pop()

  if (!lastLow || !lastHigh) return context

  context.wave1Low = lastLow.price
  context.wave1High = lastHigh.price

  const fibRange = Math.abs(lastHigh.price - lastLow.price)

  // Detect bearish sequence (lower highs/lows or last high occurred before last low with price below low)
  const isBearishSequence = lastHigh.time < lastLow.time || currentPrice < lastLow.price

  if (isBearishSequence && fibRange > 0) {
    context.fibZones = {
      fib382: lastLow.price + fibRange * 0.382,
      fib500: lastLow.price + fibRange * 0.5,
      fib618: lastLow.price + fibRange * 0.618,
    }

    if (currentPrice < lastLow.price) {
      context.currentPhase = 'WAVE_3'
    } else if (currentPrice > lastLow.price && currentPrice < context.fibZones.fib618) {
      context.currentPhase = 'WAVE_2'
    } else {
      context.currentPhase = 'ABC_CORRECTION'
    }

    context.wave5Target = Math.max(0, lastLow.price - fibRange)
    return context
  }

  // Bullish Sequence
  context.fibZones = {
    fib382: lastHigh.price - fibRange * 0.382,
    fib500: lastHigh.price - fibRange * 0.5,
    fib618: lastHigh.price - fibRange * 0.618,
  }

  if (currentPrice > lastHigh.price) {
    context.currentPhase = 'WAVE_3'
  } else if (currentPrice < lastHigh.price && currentPrice > context.fibZones.fib618) {
    context.currentPhase = 'WAVE_2'
  }

  context.wave5Target = (context.wave4Low || lastLow.price) + fibRange

  return context
}
