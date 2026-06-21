import { db } from "./src/db/database.js"

async function findDiscrepancies() {
  const trades = await db.selectFrom("trades").selectAll().execute()
  const discrepancies = []

  for (const t of trades) {
    if (t.exitPrice !== null && t.pnl !== null) {
      const calculatedPnL = (Number(t.exitPrice) - Number(t.entryPrice)) * t.quantity
      // Use a small epsilon for floating point comparison
      if (Math.abs(Number(t.pnl) - calculatedPnL) > 0.01) {
        discrepancies.push({
          id: t.id,
          symbol: t.symbol,
          qty: t.quantity,
          entry: t.entryPrice,
          exit: t.exitPrice,
          dbPnL: t.pnl,
          calcPnL: calculatedPnL,
        })
      }
    }
  }

  if (discrepancies.length === 0) {
    console.log("No PnL discrepancies found in the database.")
  } else {
    console.log(`Found ${discrepancies.length} discrepancies:`)
    console.table(discrepancies)
  }
  process.exit(0)
}

findDiscrepancies().catch(console.error)
