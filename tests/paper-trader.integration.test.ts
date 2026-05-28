import { describe, it, expect, beforeEach, vi } from "vitest"
import { PaperTrader } from "../src/execution/paper-trader.js"
import { tradeRepo } from "../src/db/repositories/trade-repo.js"

// Mock tradeRepo to avoid database side effects during tests
vi.mock("../src/db/repositories/trade-repo.js", () => ({
  tradeRepo: {
    getOpenTrades: vi.fn().mockResolvedValue([]),
    insertTrade: vi.fn().mockResolvedValue("mock-id"),
    closeTrade: vi.fn().mockResolvedValue(undefined),
  },
}))

describe("PaperTrader Integration Tests", () => {
  let trader: PaperTrader

  beforeEach(() => {
    vi.clearAllMocks()
    // Create a new instance for each test to ensure fresh state
    trader = new PaperTrader()
    // Force set initialized to true and empty positions to avoid real initialization
    ;(trader as any).initialized = true
    ;(trader as any).positions = new Map()
  })

  it("should allow placing a valid paper trade", async () => {
    const result = await trader.placeOrder({
      symbol: "NIFTY26MAY24100CE",
      token: 12345,
      strike: 24100,
      side: "BUY",
      quantity: 1,
      price: 150,
    })

    expect(result.success).toBe(true)
    expect(trader.getAllPositions()).toHaveLength(1)
    expect(tradeRepo.insertTrade).toHaveBeenCalled()
  })

  it("should reject duplicate trades for the same symbol", async () => {
    // First trade
    await trader.placeOrder({
      symbol: "NIFTY26MAY24100CE",
      token: 12345,
      strike: 24100,
      side: "BUY",
      quantity: 1,
      price: 150,
    })

    // Duplicate trade
    const result = await trader.placeOrder({
      symbol: "NIFTY26MAY24100CE",
      token: 12345,
      strike: 24100,
      side: "BUY",
      quantity: 1,
      price: 155,
    })

    expect(result.success).toBe(false)
    expect(result.error).toBe("Position already exists for this symbol")
    expect(trader.getAllPositions()).toHaveLength(1)
  })

  it("should reject duplicate trades for the same strike level", async () => {
    // First trade (CE)
    await trader.placeOrder({
      symbol: "NIFTY26MAY24100CE",
      token: 12345,
      strike: 24100,
      side: "BUY",
      quantity: 1,
      price: 150,
    })

    // Different symbol (e.g., PE) but same strike
    const result = await trader.placeOrder({
      symbol: "NIFTY26MAY24100PE",
      token: 67890,
      strike: 24100,
      side: "BUY",
      quantity: 1,
      price: 100,
    })

    expect(result.success).toBe(false)
    expect(result.error).toBe("Position already exists for strike 24100")
    expect(trader.getAllPositions()).toHaveLength(1)
  })

  it("should enforce MAX_CONCURRENT_POSITIONS limit", async () => {
    // Explicitly set limit for this test
    trader.maxConcurrentPositions = 2

    // Trade 1
    await trader.placeOrder({
      symbol: "STRIKE1",
      token: 1,
      strike: 100,
      side: "BUY",
      quantity: 1,
      price: 10,
    })

    // Trade 2
    await trader.placeOrder({
      symbol: "STRIKE2",
      token: 2,
      strike: 200,
      side: "BUY",
      quantity: 1,
      price: 20,
    })

    // Trade 3 (should be blocked)
    const result = await trader.placeOrder({
      symbol: "STRIKE3",
      token: 3,
      strike: 300,
      side: "BUY",
      quantity: 1,
      price: 30,
    })

    expect(result.success).toBe(false)
    expect(result.error).toBe("Maximum concurrent positions reached")
    expect(trader.getAllPositions()).toHaveLength(2)
  })
})
