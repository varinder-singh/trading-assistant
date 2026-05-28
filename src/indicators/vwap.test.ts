import { describe, it, expect } from "vitest"
import { calculateVWAP } from "./vwap.js"
import type { Candle } from "../types/analysis.js"

describe("calculateVWAP", () => {
  const mockCandle = (high: number, low: number, close: number, volume: number): Candle => ({
    open: (high + low) / 2,
    high,
    low,
    close,
    volume,
    time: Date.now(),
  })

  it("should return 0 if no volume", () => {
    expect(calculateVWAP([])).toBe(0)
  })

  it("should calculate VWAP correctly for a single candle", () => {
    const candle = mockCandle(110, 90, 100, 100) // typical price = (110+90+100)/3 = 100
    expect(calculateVWAP([candle])).toBe(100)
  })

  it("should calculate VWAP correctly for multiple candles", () => {
    const c1 = mockCandle(110, 90, 100, 100) // typical = 100, volume = 100, PV = 10000
    const c2 = mockCandle(120, 100, 110, 200) // typical = 110, volume = 200, PV = 22000
    // total PV = 32000, total volume = 300
    // VWAP = 32000 / 300 = 106.666...
    expect(calculateVWAP([c1, c2])).toBeCloseTo(106.67, 2)
  })
})
