import { describe, it, expect, beforeEach, vi } from "vitest"
import { PaperTrader } from "../src/execution/paper-trader.js"
import { tradeRepo } from "../src/db/repositories/trade-repo.js"

vi.mock("../src/db/repositories/trade-repo.js", () => ({
  tradeRepo: {
    getOpenTrades: vi.fn(),
    getTodaysTrades: vi.fn(),
    insertTrade: vi.fn(),
  },
}))

describe("PaperTrader Initialization Race Condition Reproduction", () => {
  let trader: PaperTrader

  beforeEach(() => {
    vi.clearAllMocks()
    trader = new PaperTrader()
  })

  it("should only call DB methods once even if initialize() is called multiple times concurrently", async () => {
    // Setup mocks with a delay to simulate real DB activity
    let callCount = 0
    tradeRepo.getOpenTrades.mockImplementation(async () => {
      callCount++
      await new Promise(resolve => setTimeout(resolve, 50))
      return []
    })
    tradeRepo.getTodaysTrades.mockImplementation(async () => {
      await new Promise(resolve => setTimeout(resolve, 50))
      return []
    })
    tradeRepo.insertTrade.mockResolvedValue("mock-uuid")

    // Call initialize multiple times concurrently
    const p1 = trader.initialize()
    const p2 = trader.initialize()
    const p3 = trader.placeOrder({
        symbol: "TEST",
        token: 1,
        side: "BUY",
        quantity: 1,
        price: 100
    })

    await Promise.all([p1, p2, p3])

    // If it works correctly, getOpenTrades should only be called ONCE
    expect(tradeRepo.getOpenTrades).toHaveBeenCalledTimes(1)
    expect(callCount).toBe(1)
  })
})
