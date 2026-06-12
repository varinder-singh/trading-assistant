import { db } from "../db/database.js";

export interface TradeMemory {
  symbol: string;
  side: string;
  pnl: number;
  ai_reasoning: string;
  status: string;
  trend_15m: string;
  vix_level: number;
}

export interface RegimeStats {
  totalTrades: number;
  winRate: number;
  averagePnL: number;
  recentTrades: TradeMemory[];
}

export class MemoryService {
  /**
   * Fetches similar past trades and computes statistical metrics to provide context for the current decision.
   */
  async getRegimeStats(trend: string, vix: number): Promise<RegimeStats | null> {
    try {
      const allTrades = await db
        .selectFrom("paper_trades")
        .select(["symbol", "side", "pnl", "ai_reasoning", "status", "trend_15m", "vix_level"])
        .where("status", "=", "CLOSED")
        .where("trend_15m", "=", trend)
        // VIX within +/- 2 points
        .where("vix_level", ">=", vix - 2)
        .where("vix_level", "<=", vix + 2)
        .orderBy("closed_at", "desc")
        .execute();

      if (allTrades.length === 0) return null;

      let wins = 0;
      let totalPnL = 0;
      allTrades.forEach((t) => {
        if (t.pnl && t.pnl > 0) wins++;
        if (t.pnl) totalPnL += t.pnl;
      });

      return {
        totalTrades: allTrades.length,
        winRate: (wins / allTrades.length) * 100,
        averagePnL: totalPnL / allTrades.length,
        recentTrades: allTrades.slice(0, 3) as TradeMemory[], // keep 3 recent for context
      };
    } catch (error) {
      console.error("[MemoryService] Failed to fetch regime stats:", error);
      return null;
    }
  }

  formatForPrompt(stats: RegimeStats | null): string {
    if (!stats) return "No similar past trades found in memory.";

    let prompt = `## LESSONS FROM PAST TRADES (MEMORY)\n`;
    prompt += `Statistical summary for this regime (Trend: ${stats.recentTrades[0]?.trend_15m || "N/A"}, VIX: ±2):\n`;
    prompt += `- Total Trades: ${stats.totalTrades}\n`;
    prompt += `- Win Rate: ${stats.winRate.toFixed(1)}%\n`;
    prompt += `- Average PnL: ${stats.averagePnL.toFixed(2)}\n\n`;

    prompt += `Recent Example Trades:\n`;
    stats.recentTrades.forEach((t, i) => {
      prompt += `${i + 1}. ${t.symbol} ${t.side} | PnL: ${t.pnl?.toFixed(2)} | Trend: ${t.trend_15m} | VIX: ${t.vix_level}\n`;
      prompt += `   Reasoning: ${t.ai_reasoning}\n`;
      prompt += `   Outcome: ${t.pnl && t.pnl > 0 ? "SUCCESS" : "FAILURE"}\n\n`;
    });
    return prompt;
  }
}

export const memoryService = new MemoryService();
