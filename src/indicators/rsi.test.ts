import { describe, it, expect } from "vitest"
import { calculateRSI } from "./rsi.js"
import type { Candle } from "../types/analysis.js"

describe("calculateRSI", () => {
  const mockCandle = (close: number): Candle => ({
    open: close,
    high: close,
    low: close,
    close: close,
    volume: 100,
    time: Date.now(),
  })

  it("should return 50 if not enough candles", () => {
    const candles = Array(10).fill(mockCandle(100))
    expect(calculateRSI(candles, 14)).toBe(50)
  })

  it("should return 100 if all candles are gains", () => {
    const candles = [
      mockCandle(100),
      mockCandle(101),
      mockCandle(102),
      mockCandle(103),
      mockCandle(104),
      mockCandle(105),
    ]
    // period is 5, need period + 1 = 6 candles
    expect(calculateRSI(candles, 5)).toBe(100)
  })

  it("should calculate RSI correctly for mixed candles", () => {
    // A simple sequence where price goes up then down
    const candles = [
      mockCandle(100), // 0
      mockCandle(102), // +2
      mockCandle(104), // +2
      mockCandle(103), // -1
      mockCandle(101), // -2
      mockCandle(105), // +4
    ]
    // period 5, 6 candles total
    // gains: 2, 2, 4 = 8. avgGain = 8/5 = 1.6
    // losses: 1, 2 = 3. avgLoss = 3/5 = 0.6
    // rs = 1.6 / 0.6 = 2.666...
    // rsi = 100 - (100 / (1 + 2.666...)) = 100 - (100 / 3.666...) = 100 - 27.27 = 72.73
    expect(calculateRSI(candles, 5)).toBe(72.73)
  })

  it("should return 0 if all candles are losses", () => {
    const candles = [mockCandle(100), mockCandle(99), mockCandle(98), mockCandle(97), mockCandle(96), mockCandle(95)]
    // gains: 0. avgGain = 0
    // losses: 1, 1, 1, 1, 1 = 5. avgLoss = 5/5 = 1
    // rs = 0 / 1 = 0
    // rsi = 100 - (100 / (1 + 0)) = 0
    expect(calculateRSI(candles, 5)).toBe(0)
  })
})
