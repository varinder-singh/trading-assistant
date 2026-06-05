import { db } from "./src/db/database.js";

async function checkTrades() {
  const trades = await db.selectFrom("paper_trades").selectAll().execute();
  console.log("ID | Symbol | Qty | Entry | Exit | PnL (DB) | Calculated PnL");
  console.log("---|---|---|---|---|---|---");
  for (const t of trades) {
    const calculatedPnL = t.exit_price ? (t.exit_price - t.entry_price) * t.quantity : null;
    console.log(`${t.id.slice(0,8)} | ${t.symbol} | ${t.quantity} | ${t.entry_price} | ${t.exit_price} | ${t.pnl} | ${calculatedPnL}`);
  }
  process.exit(0);
}

checkTrades().catch(console.error);
