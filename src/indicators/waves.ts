import type { SwingPoint, WaveContext } from '../types/analysis.js'

/**
 * Deterministically detects the current Elliott Wave phase based on swing points.
 * This is a simplified model focusing on an impulse sequence (1-2-3-4-5).
 */
function getBearishPhase(currentPrice: number, lastLowPrice: number, fib618: number): WaveContext['currentPhase'] {
  if (currentPrice < lastLowPrice) return 'WAVE_3'
  if (currentPrice > lastLowPrice && currentPrice < fib618) return 'WAVE_2'
  return 'ABC_CORRECTION'
}

function getBullishPhase(currentPrice: number, lastHighPrice: number, fib618: number): WaveContext['currentPhase'] {
  if (currentPrice > lastHighPrice) return 'WAVE_3'
  if (currentPrice < lastHighPrice && currentPrice > fib618) return 'WAVE_2'
  return 'CONSOLIDATION'
}

export function detectWaveStructure(swings: SwingPoint[], currentPrice: number): WaveContext {
  if (swings.length < 2) return { currentPhase: 'CONSOLIDATION' }

  const recentSwings = swings.slice(-10)
  const lastLow = recentSwings.filter((s) => s.type === 'LOW').pop()
  const lastHigh = recentSwings.filter((s) => s.type === 'HIGH').pop()

  if (!lastLow || !lastHigh) return { currentPhase: 'CONSOLIDATION' }

  const fibRange = Math.abs(lastHigh.price - lastLow.price)
  const isBearishSequence = lastHigh.time < lastLow.time || currentPrice < lastLow.price

  if (isBearishSequence && fibRange > 0) {
    const fibZones = {
      fib382: lastLow.price + fibRange * 0.382,
      fib500: lastLow.price + fibRange * 0.5,
      fib618: lastLow.price + fibRange * 0.618,
    }
    return {
      wave1Low: lastLow.price,
      wave1High: lastHigh.price,
      fibZones,
      currentPhase: getBearishPhase(currentPrice, lastLow.price, fibZones.fib618),
      wave5Target: Math.max(0, lastLow.price - fibRange),
    }
  }

  const fibZones = {
    fib382: lastHigh.price - fibRange * 0.382,
    fib500: lastHigh.price - fibRange * 0.5,
    fib618: lastHigh.price - fibRange * 0.618,
  }

  return {
    wave1Low: lastLow.price,
    wave1High: lastHigh.price,
    fibZones,
    currentPhase: getBullishPhase(currentPrice, lastHigh.price, fibZones.fib618),
    wave5Target: lastLow.price + fibRange,
  }
}
