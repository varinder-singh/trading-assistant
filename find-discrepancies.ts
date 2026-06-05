import { db } from "./src/db/database.js";

async function findDiscrepancies() {
  const trades = await db.selectFrom("paper_trades").selectAll().execute();
  const discrepancies = [];
  
  for (const t of trades) {
    if (t.exit_price !== null && t.pnl !== null) {
      const calculatedPnL = (t.exit_price - t.entry_price) * t.quantity;
      // Use a small epsilon for floating point comparison
      if (Math.abs(t.pnl - calculatedPnL) > 0.01) {
        discrepancies.push({
          id: t.id,
          symbol: t.symbol,
          qty: t.quantity,
          entry: t.entry_price,
          exit: t.exit_price,
          dbPnL: t.pnl,
          calcPnL: calculatedPnL
        });
      }
    }
  }
  
  if (discrepancies.length === 0) {
    console.log("No PnL discrepancies found in the database.");
  } else {
    console.log(`Found ${discrepancies.length} discrepancies:`);
    console.table(discrepancies);
  }
  process.exit(0);
}

findDiscrepancies().catch(console.error);
