import { db } from './src/db/database.js'

async function checkTrades() {
  const trades = await db.selectFrom('trades').selectAll().execute()
  console.log('ID | Symbol | Qty | Entry | Exit | PnL (DB) | Calculated PnL')
  console.log('---|---|---|---|---|---|---')
  for (const t of trades) {
    const calculatedPnL = t.exitPrice ? (Number(t.exitPrice) - Number(t.entryPrice)) * t.quantity : null
    console.log(
      `${t.id.slice(0, 8)} | ${t.symbol} | ${t.quantity} | ${t.entryPrice} | ${t.exitPrice} | ${t.pnl} | ${calculatedPnL}`
    )
  }
  process.exit(0)
}

checkTrades().catch(console.error)
