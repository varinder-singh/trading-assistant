import { tradeRepo } from "../db/repositories/trade-repo.js";
import { db } from "../db/database.js";

async function closeAllTrades() {
  console.log("🔍 Fetching all open trades...");
  const openTrades = await tradeRepo.getOpenTrades();

  if (openTrades.length === 0) {
    console.log("✅ No open trades found.");
    process.exit(0);
  }

  console.log(`Closing ${openTrades.length} trades...`);

  for (const trade of openTrades) {
    console.log(`  - Closing ${trade.symbol} (ID: ${trade.id}) at entry price ${trade.entry_price}`);
    await tradeRepo.closeTrade(trade.id, trade.entry_price);
  }

  console.log("✨ All previous trades closed successfully.");
  await db.destroy();
}

closeAllTrades().catch(err => {
  console.error("❌ Failed to close trades:", err);
  process.exit(1);
});
