import { describe, it, expect, vi } from "vitest"
import { analyzeTechnical, analyzeMultiTimeframe } from "./technical.js"

vi.mock("../indicators/trend.js", () => ({
  detectTrend: vi.fn(() => "bullish"),
}))

vi.mock("../indicators/vwap.js", () => ({
  calculateVWAP: vi.fn(() => 100),
}))

vi.mock("../indicators/rsi.js", () => ({
  calculateRSI: vi.fn(() => 70),
}))

describe("analyzeTechnical", () => {
  const mockCandle = (h: number, l: number, c: number) => ({
    open: (h + l) / 2,
    high: h,
    low: l,
    close: c,
    volume: 100,
    time: Date.now(),
  })

  it("should throw error if no candles provided", () => {
    expect(() => analyzeTechnical([])).toThrow("Cannot analyze technical indicators without candles")
  })

  it("should correctly analyze technical indicators", () => {
    const candles = [mockCandle(110, 90, 100), mockCandle(120, 100, 110)]

    const result = analyzeTechnical(candles, "15m")

    expect(result.trend).toBe("bullish")
    expect(result.vwap).toBe(100)
    expect(result.rsi).toBe(70)
    expect(result.price).toBe(110)
    expect(result.resistance).toBe(120)
    expect(result.support).toBe(90)
    expect(result.vwapPosition).toBe("above")
    expect(result.timeframe).toBe("15m")
  })
})

describe("analyzeMultiTimeframe", () => {
  it("should analyze all three timeframes", () => {
    const c1h = [{ high: 200, low: 180, close: 190, volume: 100, time: 1, open: 185 }]
    const c15m = [{ high: 100, low: 90, close: 95, volume: 10, time: 2, open: 95 }]
    const c3m = [{ high: 50, low: 40, close: 45, volume: 5, time: 3, open: 45 }]

    const result = analyzeMultiTimeframe(c1h, c15m, c3m)

    expect(result.tf1h).toBeDefined()
    expect(result.tf15m).toBeDefined()
    expect(result.tf3m).toBeDefined()
    expect(result.tf1h.timeframe).toBe("1h")
    expect(result.tf15m.timeframe).toBe("15m")
    expect(result.tf3m.timeframe).toBe("3m")
  })
})
