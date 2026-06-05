import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { PaperTrader } from "../src/execution/paper-trader.js"
import { tradeRepo } from "../src/db/repositories/trade-repo.js"
import { db } from "../src/db/database.js"

describe("Ambiguous Trade Closure Reproduction", () => {
  let trader: PaperTrader

  beforeEach(async () => {
    // Clean up DB before test
    await db.deleteFrom("paper_trades").where("symbol", "like", "REPRO_%").execute()
    trader = new PaperTrader()
  })

  afterEach(async () => {
    // Clean up DB after test
    await db.deleteFrom("paper_trades").where("symbol", "like", "REPRO_%").execute()
  })

  it("should close only ONE trade when multiple open trades exist for the same symbol (CURRENT BUGGY BEHAVIOR)", async () => {
    const symbol = "REPRO_NIFTY"
    
    // 1. Manually insert two open trades for the same symbol
    await tradeRepo.insertTrade({
      symbol,
      token: 12345,
      side: "BUY",
      quantity: 50,
      entry_price: 100,
    } as any)

    await tradeRepo.insertTrade({
      symbol,
      token: 12345,
      side: "BUY",
      quantity: 50,
      entry_price: 110,
    } as any)

    // Verify we have 2 open trades
    let openTrades = await tradeRepo.getOpenTrades()
    let reproOpenTrades = openTrades.filter(t => t.symbol === symbol)
    expect(reproOpenTrades).toHaveLength(2)

    // 2. Initialize trader (it should combine them into one position of 100 quantity)
    await trader.initialize()
    const pos = trader.getAllPositions().find(p => p.symbol === symbol)
    expect(pos).toBeDefined()
    expect(pos?.quantity).toBe(100)

    // 3. Place a SELL order for 100 quantity
    await trader.placeOrder({
      symbol,
      token: 12345,
      side: "SELL",
      quantity: 100,
      price: 120,
    })

    // 4. Check DB status
    openTrades = await tradeRepo.getOpenTrades()
    reproOpenTrades = openTrades.filter(t => t.symbol === symbol)
    
    // FIXED: It should now close ALL corresponding open trades.
    console.log(`Remaining open trades for ${symbol}: ${reproOpenTrades.length}`)
    expect(reproOpenTrades.length).toBe(0) 
  })
})
