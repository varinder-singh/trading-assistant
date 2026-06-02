import "dotenv/config"
import { tradeRepo } from "../db/repositories/trade-repo.js"
import kc from "../data/kite.js"

async function calculateTodayPnL() {
  const allTrades = await tradeRepo.getAllTrades()
  const now = new Date()
  const todayStr = now.toISOString().split("T")[0] // YYYY-MM-DD in UTC, might need adjustment for IST

  // Use Asia/Kolkata for "today"
  const todayIST = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now)

  console.log(`Calculating PnL for ${todayIST}...`)

  const todayTrades = allTrades.filter((t) => {
    const closedDate = t.closed_at ? new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(t.closed_at)) : null
    
    return closedDate === todayIST
  })

  let realizedPnL = 0
  for (const trade of todayTrades) {
    realizedPnL += trade.pnl || 0
  }

  const openTrades = await tradeRepo.getOpenTrades()
  let unrealizedPnL = 0

  if (openTrades.length > 0) {
    const tokens = openTrades.map(t => t.token).filter((t): t is number => t !== null)
    if (tokens.length > 0) {
      const quotes = await kc.getQuote(tokens.map(t => t.toString()))
      for (const trade of openTrades) {
        if (trade.token && quotes[trade.token.toString()]?.last_price !== undefined) {
          const currentPrice = quotes[trade.token.toString()].last_price
          const pnl = (currentPrice - trade.entry_price) * trade.quantity
          unrealizedPnL += pnl
        }
      }
    }
  }

  console.log("\n--- Realized Trades Today ---")
  if (todayTrades.length === 0) {
    console.log("No trades closed today.")
  } else {
    todayTrades.forEach(t => {
      console.log(`${t.symbol} (${t.side}): Entry: ${t.entry_price}, Exit: ${t.exit_price}, Qty: ${t.quantity}, PnL: ${t.pnl?.toFixed(2)}`)
    })
  }

  console.log("\n--- Open Trades ---")
  if (openTrades.length === 0) {
    console.log("No open trades.")
  } else {
    // We already calculated unrealizedPnL above, but let's log them
    const tokens = openTrades.map(t => t.token).filter((t): t is number => t !== null)
    const quotes = tokens.length > 0 ? await kc.getQuote(tokens.map(t => t.toString())) : {}
    
    openTrades.forEach(t => {
      const q = t.token ? quotes[t.token.toString()] : undefined
      const currentPrice = q ? q.last_price : "N/A"
      const pnl = q ? (q.last_price - t.entry_price) * t.quantity : 0
      console.log(`${t.symbol} (${t.side}): Entry: ${t.entry_price}, Current: ${currentPrice}, Qty: ${t.quantity}, UnPnL: ${pnl.toFixed(2)}`)
    })
  }

  console.log("\n" + "═".repeat(30))
  console.log(`Realized PnL:   ₹${realizedPnL.toFixed(2)}`)
  console.log(`Unrealized PnL: ₹${unrealizedPnL.toFixed(2)}`)
  console.log(`Total Today:    ₹${(realizedPnL + unrealizedPnL).toFixed(2)}`)
  console.log("═".repeat(30))
}

calculateTodayPnL().catch(console.error)
