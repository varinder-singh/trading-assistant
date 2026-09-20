import { db } from './src/db/database.js'

async function analyzeTrades() {
  const trades = await db.selectFrom('trades').selectAll().orderBy('openedAt', 'desc').execute()
  const analytics = await db.selectFrom('tradeAnalytics').selectAll().execute()

  console.log(`Total trades in DB: ${trades.length}`)

  const exitAnalyticsMap = new Map<string, any>()
  for (const a of analytics) {
    if (a.eventType === 'EXIT' && a.tradeId) {
      exitAnalyticsMap.set(a.tradeId, a.metadata)
    }
  }

  let totalWinPnL = 0
  let totalLossPnL = 0
  let winCount = 0
  let lossCount = 0

  for (const t of trades) {
    const pnl = Number(t.pnl) || 0
    const meta = exitAnalyticsMap.get(t.id) || {}
    const exitReason = meta.exitReason || 'Unknown'

    if (pnl > 0) {
      winCount++
      totalWinPnL += pnl
    } else if (pnl < 0) {
      lossCount++
      totalLossPnL += pnl
    }

    console.log(
      `ID: ${t.id.slice(0, 8)} | Symbol: ${t.symbol} | Qty: ${t.quantity} | Entry: ${t.entryPrice} | Exit: ${t.exitPrice} | PnL: ₹${pnl.toFixed(2)} | Reason: ${exitReason}`
    )
  }

  console.log('\n--- SUMMARY ---')
  console.log(`Total Trades: ${trades.length}`)
  console.log(`Wins: ${winCount} | Total Win PnL: ₹${totalWinPnL.toFixed(2)}`)
  console.log(`Losses: ${lossCount} | Total Loss PnL: ₹${totalLossPnL.toFixed(2)}`)
  console.log(`Net PnL: ₹${(totalWinPnL + totalLossPnL).toFixed(2)}`)

  process.exit(0)
}

analyzeTrades().catch((err) => {
  console.error(err)
  process.exit(1)
})


