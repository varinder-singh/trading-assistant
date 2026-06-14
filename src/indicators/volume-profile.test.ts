import { describe, expect, it } from "vitest"
import { calculateVolumeProfile } from "./volume-profile.js"
import type { Candle } from "../types/analysis.js"

describe("Volume Profile Indicator", () => {
  it("should calculate POC correctly", () => {
    const candles: Candle[] = [
      { time: 1, open: 100, high: 110, low: 100, close: 110, volume: 100 },
      { time: 2, open: 110, high: 120, low: 110, close: 120, volume: 500 }, // Huge volume here
      { time: 3, open: 120, high: 130, low: 120, close: 130, volume: 100 },
    ]

    // Tick size of 10
    const result = calculateVolumeProfile(candles, 10)
    expect(result).not.toBeNull()
    if (result) {
      expect(result.poc).toBeGreaterThanOrEqual(110)
      expect(result.poc).toBeLessThanOrEqual(120)
    }
  })

  it("should return null for empty candles", () => {
    const result = calculateVolumeProfile([])
    expect(result).toBeNull()
  })

  it("should classify D profile correctly", () => {
    // Accumulation in the middle
    const candles: Candle[] = [
      { time: 1, open: 100, high: 120, low: 100, close: 120, volume: 10 },
      { time: 2, open: 120, high: 130, low: 120, close: 130, volume: 500 },
      { time: 3, open: 130, high: 150, low: 130, close: 150, volume: 10 },
    ]

    const result = calculateVolumeProfile(candles, 10)
    expect(result?.profileType).toBe("D")
  })

  it("should classify P profile correctly", () => {
    // Accumulation at the top
    const candles: Candle[] = [
      { time: 1, open: 100, high: 110, low: 100, close: 110, volume: 10 },
      { time: 2, open: 110, high: 120, low: 110, close: 120, volume: 10 },
      { time: 3, open: 120, high: 130, low: 120, close: 130, volume: 500 },
    ]

    const result = calculateVolumeProfile(candles, 10)
    expect(result?.profileType).toBe("P")
  })

  it("should classify B profile correctly", () => {
    // Accumulation at the bottom
    const candles: Candle[] = [
      { time: 1, open: 100, high: 110, low: 100, close: 110, volume: 500 },
      { time: 2, open: 110, high: 120, low: 110, close: 120, volume: 10 },
      { time: 3, open: 120, high: 130, low: 120, close: 130, volume: 10 },
    ]

    const result = calculateVolumeProfile(candles, 10)
    expect(result?.profileType).toBe("B")
  })
})
