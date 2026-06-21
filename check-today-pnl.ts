import { db } from "./src/db/database.js"

async function checkTodayTrades() {
  const today = new Date().toISOString().split("T")[0]
  const trades = await db
    .selectFrom("trades")
    .selectAll()
    .where("openedAt", ">=", `${today}T00:00:00Z`)
    .execute()

  console.log(`Checking trades for ${today}:`)
  console.log("ID | Symbol | Qty | Entry | Exit | PnL (DB) | Calculated PnL")
  console.log("---|---|---|---|---|---|---")
  for (const t of trades) {
    const calculatedPnL = t.exitPrice ? (Number(t.exitPrice) - Number(t.entryPrice)) * t.quantity : null
    console.log(
      `${t.id.slice(0, 8)} | ${t.symbol} | ${t.quantity} | ${t.entryPrice} | ${t.exitPrice} | ${t.pnl} | ${calculatedPnL}`
    )
  }
  process.exit(0)
}

checkTodayTrades().catch(console.error)
