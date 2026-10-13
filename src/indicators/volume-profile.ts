import type { Candle, ProfileType, VolumeNode, VolumeProfile } from '../types/analysis.js'

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

export function calculateVolumeProfile(
  candles: Candle[],
  tickSize: number = 5,
  valueAreaPct: number = 0.7
): VolumeProfile | null {
  if (candles.length === 0) return null

  const { minPrice, maxPrice, totalVolume } = candles.reduce(
    (acc, c) => ({
      minPrice: Math.min(acc.minPrice, c.low),
      maxPrice: Math.max(acc.maxPrice, c.high),
      totalVolume: acc.totalVolume + c.volume,
    }),
    { minPrice: Infinity, maxPrice: -Infinity, totalVolume: 0 }
  )

  if (totalVolume === 0) return null

  // Round min to nearest tick size downwards, max to nearest tick size upwards
  const roundedMin = Math.floor(minPrice / tickSize) * tickSize
  const roundedMax = Math.ceil(maxPrice / tickSize) * tickSize

  const binCount = Math.floor((roundedMax - roundedMin) / tickSize) + 1
  const bins = new Float64Array(binCount)

  // Distribute volume evenly across the bins that the candle spans
  candles.forEach((c) => {
    const startBin = Math.floor((c.low - roundedMin) / tickSize)
    const endBin = Math.floor((c.high - roundedMin) / tickSize)
    const binsAffected = endBin - startBin + 1
    const volPerBin = c.volume / binsAffected

    Array.from({ length: binsAffected }, (_, idx) => startBin + idx).forEach((i) => {
      if (i >= 0 && i < binCount) {
        bins[i] = (bins[i] ?? 0) + volPerBin
      }
    })
  })

  const pocBin = Array.from(bins).reduce((maxIdx, vol, i, arr) => (vol > (arr[maxIdx] ?? -1) ? i : maxIdx), 0)
  const maxVol = bins[pocBin] ?? 0
  const poc = roundedMin + pocBin * tickSize

  // Calculate Value Area expanding symmetrically from POC
  const targetVol = totalVolume * valueAreaPct
  let currentVol = bins[pocBin] ?? 0
  let upBin = pocBin + 1
  let downBin = pocBin - 1

  while (currentVol < targetVol && (upBin < binCount || downBin >= 0)) {
    const volUp = upBin < binCount ? (bins[upBin] ?? 0) : 0
    const volDown = downBin >= 0 ? (bins[downBin] ?? 0) : 0

    if (volUp >= volDown && upBin < binCount) {
      currentVol += volUp
      upBin++
    } else if (volDown > volUp && downBin >= 0) {
      currentVol += volDown
      downBin--
    } else if (upBin < binCount) {
      currentVol += volUp
      upBin++
    } else {
      currentVol += volDown
      downBin--
    }
  }

  const vah = roundedMin + (upBin - 1) * tickSize
  const val = roundedMin + (downBin + 1) * tickSize

  const range = roundedMax - roundedMin
  const avgVolPerBin = totalVolume / binCount
  const valueAreaRange = vah - val
  const profileType = determineProfileType(range, poc, roundedMin, maxVol, avgVolPerBin, valueAreaRange)

  const nodes: VolumeNode[] = Array.from({ length: binCount }, (_, i) => ({
    price: roundedMin + i * tickSize,
    volume: bins[i] ?? 0,
  }))

  return { poc, vah, val, profileType, nodes }
}
