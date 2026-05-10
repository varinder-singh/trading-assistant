import type { Candle } from "../types/analysis.js"

export function detectTrend(candles: Candle[]): "bullish" | "bearish" | "sideways" {
  if (candles.length < 2) {
    return "sideways"
  }

  const closes = candles.slice(-20).map(c => c.close)

  const first = closes[0]
  const last = closes[closes.length - 1]
  if (first === undefined || last === undefined || first === 0) {
    return "sideways"
  }

  const change = ((last - first) / first) * 100

  if (change > 0.5) return "bullish"
  if (change < -0.5) return "bearish"
  return "sideways"
}
