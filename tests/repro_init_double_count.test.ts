import { describe, it, expect, beforeEach, vi } from "vitest"
import { PaperTrader } from "../src/execution/paper-trader.js"
import { tradeRepo } from "../src/db/repositories/trade-repo.js"

vi.mock("../src/db/repositories/trade-repo.js", () => ({
  tradeRepo: {
    getOpenTrades: vi.fn(),
    getTodaysTrades: vi.fn(),
  },
}))

describe("PaperTrader Double-Counting on Retry", () => {
  let trader: PaperTrader

  beforeEach(() => {
    vi.clearAllMocks()
    trader = new PaperTrader()
  })

  it("should NOT double-count positions if initialization is retried after failure", async () => {
    const mockTrade = {
      symbol: "TEST",
      token: 1,
      quantity: 100,
      entry_price: 50,
      opened_at: new Date().toISOString(),
    }

    tradeRepo.getOpenTrades.mockResolvedValue([mockTrade])
    tradeRepo.getTodaysTrades.mockResolvedValue([])

    // Force a failure in the middle of initialization
    // We can do this by making one of the methods called at the end throw
    // or by mocking a later part of the loop.
    
    // Actually, let's just manually trigger initialization twice and see if positions grow.
    // But initialize() has a guard. We need to reset the promise but keep initialized=false.
    
    await trader.initialize()
    expect(trader.getAllPositions()[0].quantity).toBe(100)

    // Simulate failure by resetting the promise but NOT the initialized flag
    // (In reality, a real failure would clear the promise in the 'finally' block)
    ;(trader as any).initialized = false
    ;(trader as any).initializationPromise = null

    await trader.initialize()
    
    // FIXED: It should still be 100 because initialize() now uses a local map and resets state.
    const positions = trader.getAllPositions()
    console.log(`Quantity after second init: ${positions[0].quantity}`)
    expect(positions[0].quantity).toBe(100)
  })
})
