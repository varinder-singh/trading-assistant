import type { Candle, ProfileType, VolumeNode, VolumeProfile } from '../types/analysis.js'

interface BinContribution {
  bin: number
  volume: number
}

interface ValueAreaState {
  currentVol: number
  upBin: number
  downBin: number
}

function determineProfileType(
  range: number,
  poc: number,
  roundedMin: number,
  maxVol: number,
  avgVolPerBin: number,
  valueAreaRange: number
): ProfileType {
  if (range <= 0) return 'UNKNOWN'

  const normalizedPoc = (poc - roundedMin) / range
  if (maxVol < avgVolPerBin * 2.5 && valueAreaRange / range > 0.75) return 'I'
  if (normalizedPoc > 0.65) return 'P'
  if (normalizedPoc < 0.35) return 'B'
  return 'D'
}

function calculatePriceBounds(candles: Candle[]): { minPrice: number; maxPrice: number; totalVolume: number } {
  return candles.reduce(
    (acc, c) => ({
      minPrice: Math.min(acc.minPrice, c.low),
      maxPrice: Math.max(acc.maxPrice, c.high),
      totalVolume: acc.totalVolume + c.volume,
    }),
    { minPrice: Infinity, maxPrice: -Infinity, totalVolume: 0 }
  )
}

/** Distributes a candle's volume evenly across every price bin the candle spans. */
function toBinContributions(candle: Candle, roundedMin: number, tickSize: number): BinContribution[] {
  const startBin = Math.floor((candle.low - roundedMin) / tickSize)
  const endBin = Math.floor((candle.high - roundedMin) / tickSize)
  const binsAffected = endBin - startBin + 1

  return Array.from({ length: binsAffected }, (_, idx) => ({
    bin: startBin + idx,
    volume: candle.volume / binsAffected,
  }))
}

function buildVolumeBins(candles: Candle[], roundedMin: number, tickSize: number, binCount: number): number[] {
  const contributions = candles
    .flatMap((candle) => toBinContributions(candle, roundedMin, tickSize))
    .filter(({ bin }) => bin >= 0 && bin < binCount)

  return Array.from({ length: binCount }, (_, i) =>
    contributions.filter(({ bin }) => bin === i).reduce((sum, { volume }) => sum + volume, 0)
  )
}

/** Expands the value area one bin at a time (towards the heavier side) until the target volume is covered. */
function expandValueArea(bins: number[], state: ValueAreaState, targetVol: number): ValueAreaState {
  const { currentVol, upBin, downBin } = state
  const canExpandUp = upBin < bins.length
  const canExpandDown = downBin >= 0

  if (currentVol >= targetVol || (!canExpandUp && !canExpandDown)) return state

  const volUp = canExpandUp ? (bins[upBin] ?? 0) : 0
  const volDown = canExpandDown ? (bins[downBin] ?? 0) : 0

  return canExpandUp && volUp >= volDown
    ? expandValueArea(bins, { currentVol: currentVol + volUp, upBin: upBin + 1, downBin }, targetVol)
    : expandValueArea(bins, { currentVol: currentVol + volDown, upBin, downBin: downBin - 1 }, targetVol)
}

function calculateValueArea(
  bins: number[],
  pocBin: number,
  roundedMin: number,
  tickSize: number,
  targetVol: number
): { vah: number; val: number } {
  const initialState = { currentVol: bins[pocBin] ?? 0, upBin: pocBin + 1, downBin: pocBin - 1 }
  const { upBin, downBin } = expandValueArea(bins, initialState, targetVol)

  return {
    vah: roundedMin + (upBin - 1) * tickSize,
    val: roundedMin + (downBin + 1) * tickSize,
  }
}

function buildVolumeNodes(bins: number[], roundedMin: number, tickSize: number): VolumeNode[] {
  return bins.map((volume, i) => ({ price: roundedMin + i * tickSize, volume }))
}

export function calculateVolumeProfile(
  candles: Candle[],
  tickSize: number = 5,
  valueAreaPct: number = 0.7
): VolumeProfile | null {
  if (candles.length === 0) return null

  const { minPrice, maxPrice, totalVolume } = calculatePriceBounds(candles)
  if (totalVolume === 0) return null

  const roundedMin = Math.floor(minPrice / tickSize) * tickSize
  const roundedMax = Math.ceil(maxPrice / tickSize) * tickSize
  const binCount = Math.floor((roundedMax - roundedMin) / tickSize) + 1

  const bins = buildVolumeBins(candles, roundedMin, tickSize, binCount)
  const pocBin = bins.reduce((maxIdx, vol, i) => (vol > (bins[maxIdx] ?? -1) ? i : maxIdx), 0)
  const maxVol = bins[pocBin] ?? 0
  const poc = roundedMin + pocBin * tickSize

  const { vah, val } = calculateValueArea(bins, pocBin, roundedMin, tickSize, totalVolume * valueAreaPct)
  const avgVolPerBin = totalVolume / binCount
  const profileType = determineProfileType(roundedMax - roundedMin, poc, roundedMin, maxVol, avgVolPerBin, vah - val)

  return { poc, vah, val, profileType, nodes: buildVolumeNodes(bins, roundedMin, tickSize) }
}
