import { describe, it, expect } from "vitest"
import { validateRegime } from "./regime-validator.js"
import type { MarketContext, OrchestratorResponse } from "./types.js"

describe("Regime Validator", () => {
  const baseMarketData = {
    tf1h: { trend: "bullish" },
    tf15m: { trend: "bullish" },
    dailyContext: { isCompression: true },
    vix: { current: 15 },
    optionsAnalysisZerodha: { marketFlow: "SHORT_COVERING" }
  } as unknown as MarketContext

  it("should pass SCALPER through without validation", () => {
    const result = validateRegime(
      { activeAgent: "SCALPER", confidence: 90, rationale: "" },
      baseMarketData
    )
    expect(result.activeAgent).toBe("SCALPER")
    expect(result.wasOverridden).toBe(false)
  })

  it("should allow TREND when all conditions are met", () => {
    const result = validateRegime(
      { activeAgent: "TREND", confidence: 90, rationale: "" },
      baseMarketData
    )
    expect(result.activeAgent).toBe("TREND")
    expect(result.wasOverridden).toBe(false)
    expect(result.checks.every(c => c.passed)).toBe(true)
  })

  it("should override TREND to SCALPER when trends conflict", () => {
    const badData = {
      ...baseMarketData,
      tf15m: { trend: "sideways" }
    } as unknown as MarketContext

    const result = validateRegime(
      { activeAgent: "TREND", confidence: 90, rationale: "" },
      badData
    )
    expect(result.activeAgent).toBe("SCALPER")
    expect(result.wasOverridden).toBe(true)
    const trendCheck = result.checks.find(c => c.name === "Multi-TF Trend Alignment")
    expect(trendCheck?.passed).toBe(false)
  })

  it("should override TREND to SCALPER when VIX > 25", () => {
    const badData = {
      ...baseMarketData,
      vix: { current: 26 }
    } as unknown as MarketContext

    const result = validateRegime(
      { activeAgent: "TREND", confidence: 90, rationale: "" },
      badData
    )
    expect(result.activeAgent).toBe("SCALPER")
    expect(result.wasOverridden).toBe(true)
    const vixCheck = result.checks.find(c => c.name === "VIX Sanity")
    expect(vixCheck?.passed).toBe(false)
  })

  it("should override TREND to SCALPER when options flow contradicts bullish trend", () => {
    const badData = {
      ...baseMarketData,
      optionsAnalysisZerodha: { marketFlow: "SHORT_BUILDUP" }
    } as unknown as MarketContext

    const result = validateRegime(
      { activeAgent: "TREND", confidence: 90, rationale: "" },
      badData
    )
    expect(result.activeAgent).toBe("SCALPER")
    expect(result.wasOverridden).toBe(true)
    const flowCheck = result.checks.find(c => c.name === "Options Flow Agreement")
    expect(flowCheck?.passed).toBe(false)
  })
})
