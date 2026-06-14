import { db } from "./src/db/database.js"

async function checkTodayTrades() {
  const today = new Date().toISOString().split("T")[0]
  const trades = await db
    .selectFrom("paper_trades")
    .selectAll()
    .where("opened_at", ">=", `${today}T00:00:00Z`)
    .execute()

  console.log(`Checking trades for ${today}:`)
  console.log("ID | Symbol | Qty | Entry | Exit | PnL (DB) | Calculated PnL")
  console.log("---|---|---|---|---|---|---")
  for (const t of trades) {
    const calculatedPnL = t.exit_price ? (t.exit_price - t.entry_price) * t.quantity : null
    console.log(
      `${t.id.slice(0, 8)} | ${t.symbol} | ${t.quantity} | ${t.entry_price} | ${t.exit_price} | ${t.pnl} | ${calculatedPnL}`
    )
  }
  process.exit(0)
}

checkTodayTrades().catch(console.error)
