import type { OpeningRange, VolumeProfile } from "./analysis.js"

// technical analysis
export type DailyContext = {
  atr14: number
  pdh: number
  pdl: number
  pdc: number
  pdr: number
  isCompression: boolean
  currentDayOpen: number
  openingRange?: OpeningRange | undefined
  previousDayVolumeProfile?: VolumeProfile | undefined
}
