import type { Analysis, TradePlan } from "../types/analysis.js"
import type { MarketMode } from "../types/mode.js"


export function generateTradePlan(analysis: Analysis, mode: MarketMode): TradePlan {
  const { trend, support, resistance, price } = analysis

  const rangeMid = (support + resistance) / 2

  // 🔴 1. Avoid middle zone
  if (price > support + (resistance - support) * 0.3 &&
    price < support + (resistance - support) * 0.7) {
    return {
      decision: "NO_TRADE",
      reason: "Price in middle of range (low edge zone)",
    }
  }

  // 🟢 2. Breakout Buy Setup
  if (price > resistance * 0.995 && trend === "bullish") {
    const entry = resistance + 10
    const stopLoss = resistance - 120
    const target = entry + (entry - stopLoss) * 2

    return {
      decision: "BUY",
      reason: "Near resistance breakout with bullish trend",
      entry,
      stopLoss,
      targets: [target],
      riskReward: 2,
    }
  }

  // 🔴 3. Resistance Rejection Sell
  if (price > resistance * 0.98 && trend !== "bullish") {
    const entry = price
    const stopLoss = resistance + 80
    const target = support

    const rr = (entry - target) / (stopLoss - entry)

    return {
      decision: "SELL",
      reason: "Rejection near resistance",
      entry,
      stopLoss,
      targets: [target],
      riskReward: Number(rr.toFixed(2)),
    }
  }

  // 🔴 4. Breakdown Sell
  if (price < support * 1.005) {
    const entry = support - 10
    const stopLoss = support + 100
    const target = entry - (stopLoss - entry) * 2

    return {
      decision: "SELL",
      reason: "Breakdown below support",
      entry,
      stopLoss,
      targets: [target],
      riskReward: 2,
    }
  }

  return {
    decision: "NO_TRADE",
    reason: "No clear setup",
  }
}

export function handleIntradayTrade(analysis: Analysis) {
  const { trend, support, resistance, price } = analysis
  const range = resistance - support
  const midLow = support + range * 0.3
  const midHigh = support + range * 0.7

  // 🔴 INTRADAY: Strict rules
  // Avoid middle zone aggressively
  if (price > midLow && price < midHigh) {
    return {
      decision: "NO_TRADE",
      reason: "Intraday: price in middle (low probability zone)",
    }
  }

  // Breakout
  if (price >= resistance * 0.995 && trend === "bullish") {
    const entry = resistance + 10
    const sl = resistance - 120
    const target = entry + (entry - sl) * 2

    return {
      decision: "BUY",
      reason: "Intraday breakout",
      entry,
      stopLoss: sl,
      targets: [target],
      riskReward: 2,
    }
  }

  // Rejection sell
  if (price >= resistance * 0.98 && trend !== "bullish") {
    const entry = price
    const sl = resistance + 80
    const target = support

    const rr = (entry - target) / (sl - entry)

    return {
      decision: "SELL",
      reason: "Intraday rejection",
      entry,
      stopLoss: sl,
      targets: [target],
      riskReward: Number(rr.toFixed(2)),
    }
  }
}

export function handleSwingTrade(analysis: Analysis) {
  const { trend, support, resistance, price } = analysis
  const range = resistance - support
  const midLow = support + range * 0.3
  const midHigh = support + range * 0.7
  // Allow trades even in mid zone if trend is strong
  if (trend === "bullish") {
    const entry = price
    const sl = support
    const target = price + (price - sl) * 2

    return {
      decision: "BUY",
      reason: "Swing: bullish trend continuation",
      entry,
      stopLoss: sl,
      targets: [target],
      riskReward: 2,
    }
  }

  if (trend === "bearish") {
    const entry = price
    const sl = resistance
    const target = price - (sl - price) * 2

    return {
      decision: "SELL",
      reason: "Swing: bearish trend continuation",
      entry,
      stopLoss: sl,
      targets: [target],
      riskReward: 2,
    }
  }

  return {
    decision: "NO_TRADE",
    reason: "Swing: no clear trend",
  }
}
