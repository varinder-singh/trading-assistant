import type { Candle, ProfileType, VolumeNode, VolumeProfile } from "../types/analysis.js"

export function calculateVolumeProfile(
  candles: Candle[],
  tickSize: number = 5,
  valueAreaPct: number = 0.7
): VolumeProfile | null {
  if (candles.length === 0) return null

  let minPrice = Infinity
  let maxPrice = -Infinity
  let totalVolume = 0

  for (const c of candles) {
    if (c.low < minPrice) minPrice = c.low
    if (c.high > maxPrice) maxPrice = c.high
    totalVolume += c.volume
  }

  if (totalVolume === 0) return null

  // Round min to nearest tick size downwards, max to nearest tick size upwards
  const roundedMin = Math.floor(minPrice / tickSize) * tickSize
  const roundedMax = Math.ceil(maxPrice / tickSize) * tickSize

  const binCount = Math.floor((roundedMax - roundedMin) / tickSize) + 1
  const bins = new Float64Array(binCount)

  // Distribute volume evenly across the bins that the candle spans
  for (const c of candles) {
    const startBin = Math.floor((c.low - roundedMin) / tickSize)
    const endBin = Math.floor((c.high - roundedMin) / tickSize)
    const binsAffected = endBin - startBin + 1
    const volPerBin = c.volume / binsAffected

    for (let i = startBin; i <= endBin; i++) {
      if (i >= 0 && i < binCount) {
        bins[i] = (bins[i] ?? 0) + volPerBin
      }
    }
  }

  let pocBin = 0
  let maxVol = -1
  for (let i = 0; i < binCount; i++) {
    const binVol = bins[i] ?? 0
    if (binVol > maxVol) {
      maxVol = binVol
      pocBin = i
    }
  }

  const poc = roundedMin + pocBin * tickSize

  // Calculate Value Area expanding symmetrically from POC
  let targetVol = totalVolume * valueAreaPct
  let currentVol = bins[pocBin] ?? 0
  let upBin = pocBin + 1
  let downBin = pocBin - 1

  while (currentVol < targetVol && (upBin < binCount || downBin >= 0)) {
    const volUp = upBin < binCount ? (bins[upBin] ?? 0) : 0
    const volDown = downBin >= 0 ? (bins[downBin] ?? 0) : 0

    // Expand towards the side with more volume
    if (volUp >= volDown && upBin < binCount) {
      currentVol += volUp
      upBin++
    } else if (volDown > volUp && downBin >= 0) {
      currentVol += volDown
      downBin--
    } else if (upBin < binCount) {
      currentVol += volUp
      upBin++
    } else if (downBin >= 0) {
      currentVol += volDown
      downBin--
    }
  }

  // upBin and downBin are the bounds
  const vah = roundedMin + (upBin - 1) * tickSize
  const val = roundedMin + (downBin + 1) * tickSize

  // Profile Type Heuristic
  const range = roundedMax - roundedMin
  let profileType: ProfileType = "UNKNOWN"

  if (range > 0) {
    const normalizedPoc = (poc - roundedMin) / range

    const avgVolPerBin = totalVolume / binCount
    const valueAreaRange = vah - val

    // I Profile: thin volume, spread evenly
    if (maxVol < avgVolPerBin * 2.5 && valueAreaRange / range > 0.75) {
      profileType = "I"
    } else if (normalizedPoc > 0.65) {
      profileType = "P"
    } else if (normalizedPoc < 0.35) {
      profileType = "B"
    } else {
      profileType = "D"
    }
  }

  const nodes: VolumeNode[] = []
  for (let i = 0; i < binCount; i++) {
    nodes.push({
      price: roundedMin + i * tickSize,
      volume: bins[i] ?? 0,
    })
  }

  return { poc, vah, val, profileType, nodes }
}
