import { tradeRepo } from "../db/repositories/trade-repo.js"
import { LLMService } from "../ai/llm.js"

/**
 * Backtest Script: Multi-Agent Evaluator
 * This script fetches closed paper trades from a specific date and
 * evaluates how the new Orchestrator Agent would have categorized them.
 *
 * Usage: tsx src/scripts/backtest-agents.ts [YYYY-MM-DD]
 */

const llm = new LLMService()

async function runBacktest() {
  const dateArg = process.argv[2] || new Date().toISOString().split("T")[0]
  console.log(`\n🔍 Starting Multi-Agent Backtest for Date: ${dateArg}`)
  console.log("=".repeat(60))

  try {
    const allTrades = await tradeRepo.getAllTrades()
    // Support both ISO (2026-05-29T...) and Locale (29/05/2026, ...) formats
    const targetTrades = allTrades.filter((t) => {
      const openedAt = t.opened_at || ""
      return openedAt.includes(dateArg) || new Date(openedAt).toLocaleDateString("en-CA") === dateArg // en-CA gives YYYY-MM-DD
    })

    if (targetTrades.length === 0) {
      console.log(`No closed trades found for ${dateArg}.`)
      return
    }

    console.log(`Found ${targetTrades.length} closed trades. Evaluating with Orchestrator...\n`)

    let trendUpgrades = 0
    let scalperMaintained = 0

    for (const trade of targetTrades.reverse()) {
      // Extract time in a readable format regardless of storage format
      const time = new Date(trade.opened_at).toLocaleTimeString("en-IN", {
        timeZone: "Asia/Kolkata",
        hour12: false,
      })

      const context = {
        symbol: trade.symbol,
        entry: trade.entry_price,
        exit: trade.exit_price,
        pnl: trade.pnl,
        reason: trade.ai_reasoning,
        setup: trade.setup,
        strategy: trade.strategy_context,
      }

      const orchestrator = await llm.evaluateMarketState(context)

      console.log(`[${time} IST] ${trade.symbol} | PnL: ${trade.pnl?.toFixed(2)}`)
      console.log(`Agent: ${orchestrator.activeAgent} (${orchestrator.confidence}%)`)
      console.log(`Rationale: ${orchestrator.rationale}`)

      if (orchestrator.activeAgent === "TREND") {
        trendUpgrades++
        if (trade.pnl && trade.pnl < 0) {
          console.log(`💡 POTENTIAL RECOVERY: Trend mode might have saved this loss with wider stops.`)
        } else {
          console.log(`🚀 RALLY CAPTURE: Trend mode might have extended these gains.`)
        }
      } else {
        scalperMaintained++
      }
      console.log("-".repeat(40))
    }

    console.log("\n" + "=".repeat(60))
    console.log(`BACKTEST SUMMARY for ${dateArg}:`)
    console.log(`Total Trades: ${targetTrades.length}`)
    console.log(`SCALPER Maintained: ${scalperMaintained}`)
    console.log(`TREND Upgrades: ${trendUpgrades}`)
    console.log("=".repeat(60))
  } catch (error) {
    console.error("Backtest failed:", error)
  }
}

runBacktest()
