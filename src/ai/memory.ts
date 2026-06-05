import { db } from "../db/database.js"

export interface TradeMemory {
  symbol: string
  side: string
  pnl: number
  ai_reasoning: string
  status: string
  trend_15m: string
  vix_level: number
}

export class MemoryService {
  /**
   * Fetches similar past trades to provide context for the current decision.
   * Since we don't have a Vector DB, we use SQL filters for similar market regimes.
   */
  async getSimilarTrades(trend: string, vix: number): Promise<TradeMemory[]> {
    try {
      const trades = await db
        .selectFrom("paper_trades")
        .select(["symbol", "side", "pnl", "ai_reasoning", "status", "trend_15m", "vix_level"])
        .where("status", "=", "CLOSED")
        .where("trend_15m", "=", trend)
        // VIX within +/- 2 points
        .where("vix_level", ">=", vix - 2)
        .where("vix_level", "<=", vix + 2)
        .orderBy("closed_at", "desc")
        .limit(3)
        .execute()

      return trades as TradeMemory[]
    } catch (error) {
      console.error("[MemoryService] Failed to fetch similar trades:", error)
      return []
    }
  }

  formatForPrompt(trades: TradeMemory[]): string {
    if (trades.length === 0) return "No similar past trades found in memory."

    let prompt = "## LESSONS FROM PAST TRADES (MEMORY)\n"
    trades.forEach((t, i) => {
      prompt += `${i + 1}. ${t.symbol} ${t.side} | PnL: ${t.pnl?.toFixed(2)} | Trend: ${t.trend_15m} | VIX: ${t.vix_level}\n`
      prompt += `   Reasoning: ${t.ai_reasoning}\n`
      prompt += `   Outcome: ${t.pnl && t.pnl > 0 ? "SUCCESS" : "FAILURE"}\n\n`
    })
    return prompt
  }
}

export const memoryService = new MemoryService()
