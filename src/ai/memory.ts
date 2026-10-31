import { db as dbDefault } from '../db/database.js'
import { Kysely, sql } from 'kysely'
import type { Database } from '../db/database.js'

export interface TradeMemory {
  symbol: string
  side: string
  pnl: number
  ai_reasoning: string
  status: string
  trend_15m: string
  vix_level: number
}

export interface RegimeStats {
  totalTrades: number
  winRate: number
  averagePnL: number
  recentTrades: TradeMemory[]
}

export class MemoryService {
  private db: Kysely<Database>

  constructor(db: Kysely<Database> = dbDefault) {
    this.db = db
  }

  /**
   * Fetches similar past trades and computes statistical metrics to provide context for the current decision.
   */
  async getRegimeStats(userId: string, symbol: string, trend: string, vix: number): Promise<RegimeStats | null> {
    if (!userId) return null
    try {
      const allTrades = await this.db
        .selectFrom('trades')
        .innerJoin('tradeAnalytics', 'tradeAnalytics.tradeId', 'trades.id')
        .select([
          'trades.symbol',
          'trades.side',
          'trades.pnl',
          'trades.status',
          sql<string>`trade_analytics.metadata->>'aiReasoning'`.as('ai_reasoning'),
          sql<string>`trade_analytics.metadata->>'trend15m'`.as('trend_15m'),
          sql<number>`CAST(trade_analytics.metadata->>'vixLevel' AS NUMERIC)`.as('vix_level'),
        ])
        .where('trades.status', '=', 'CLOSED')
        .where('trades.isPaperTrade', '=', true)
        .where('trades.userId', '=', userId)
        .where('trades.symbol', '=', symbol)
        .where(sql<string>`trade_analytics.metadata->>'trend15m'`, '=', trend)
        .where(sql<number>`CAST(trade_analytics.metadata->>'vixLevel' AS NUMERIC)`, '>=', vix - 2)
        .where(sql<number>`CAST(trade_analytics.metadata->>'vixLevel' AS NUMERIC)`, '<=', vix + 2)
        .orderBy('trades.closedAt', 'desc')
        .execute()

      if (allTrades.length === 0) return null

      const wins = allTrades.filter((t) => Number(t.pnl) > 0).length
      const totalPnL = allTrades.reduce((sum, t) => sum + (Number(t.pnl) || 0), 0)

      return {
        totalTrades: allTrades.length,
        winRate: (wins / allTrades.length) * 100,
        averagePnL: totalPnL / allTrades.length,
        recentTrades: allTrades.slice(0, 3).map((t) => ({
          ...t,
          pnl: Number(t.pnl) || 0,
        })) as TradeMemory[],
      }
    } catch (error) {
      console.error('[MemoryService] Failed to fetch regime stats:', error)
      return null
    }
  }

  formatForPrompt(stats: RegimeStats | null): string {
    if (!stats) return 'No similar past trades found in memory.'

    const header = [
      `## PAST TRADE CONTEXT (MEMORY)`,
      `Statistical summary for this regime (Trend: ${stats.recentTrades[0]?.trend_15m || 'N/A'}, VIX: ±2):`,
      `- Total Trades: ${stats.totalTrades}`,
      `- Win Rate: ${stats.winRate.toFixed(1)}%`,
      `- Average PnL: ${stats.averagePnL.toFixed(2)}\n`,
      `Recent Trades in Similar Conditions:`,
    ].join('\n')

    const tradesList = stats.recentTrades
      .map((t, i) => {
        const pnl = Number(t.pnl)
        const status = pnl > 0 ? 'PROFIT' : 'LOSS'
        return `${i + 1}. ${t.symbol} ${t.side} | PnL: ₹${pnl.toFixed(2)} (${status}) | Trend: ${t.trend_15m} | VIX: ${t.vix_level}\n   Reasoning: ${t.ai_reasoning}\n`
      })
      .join('\n')

    const note = `NOTE: Past losses may indicate regime-specific patterns worth noting, but do NOT let them reduce your confidence if the CURRENT technical setup, options flow, and wave structure independently support a trade. Each setup is unique — judge it on its own merits.\n`

    return `${header}\n${tradesList}\n${note}`
  }
}

export const memoryService = new MemoryService()
