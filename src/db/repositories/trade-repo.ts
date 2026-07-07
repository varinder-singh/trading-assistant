import { db as dbDefault } from '../database.js'
import crypto from 'node:crypto'
import { Kysely } from 'kysely'
import type { Database } from '../database.js'

export interface NewPaperTradeInput {
  userId: string
  symbol: string
  token: number
  side: 'BUY' | 'SELL'
  quantity: number
  entry_price: number
  strike_price?: number | null
  ai_reasoning?: string | null
  ai_confidence?: number | null
  vix_level?: number | null
  rsi_level?: number | null
  trend_15m?: string | null
  ai_stop_loss?: number | null
  ai_target?: number | null
  setup?: string | null
  strategy_context?: string | null
  agentType?: string | null
}

export class TradeRepository {
  private db: Kysely<Database>

  constructor(db: Kysely<Database> = dbDefault) {
    this.db = db
  }

  async insertTrade(trade: NewPaperTradeInput) {
    const id = crypto.randomUUID()
    const now = new Date().toISOString()

    // 1. Insert Core Trade
    await this.db
      .insertInto('trades')
      .values({
        id,
        userId: trade.userId,
        brokerAccountId: null, // Paper trade
        isPaperTrade: true,
        symbol: trade.symbol,
        instrumentToken: trade.token,
        strikePrice: trade.strike_price ? String(trade.strike_price) : null,
        side: trade.side,
        quantity: trade.quantity,
        status: 'OPEN',
        entryPrice: String(trade.entry_price),
        exitPrice: null,
        pnl: null,
        openedAt: now,
        closedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .execute()

    // 2. Insert Analytics Log (ENTRY)
    const analyticsId = crypto.randomUUID()
    await this.db
      .insertInto('tradeAnalytics')
      .values({
        id: analyticsId,
        tradeId: id,
        eventType: 'ENTRY',
        agentType: trade.agentType || null,
        symbol: trade.symbol,
        side: trade.side,
        metadata: JSON.stringify({
          aiReasoning: trade.ai_reasoning,
          aiConfidence: trade.ai_confidence,
          vixLevel: trade.vix_level,
          rsiLevel: trade.rsi_level,
          trend15m: trade.trend_15m,
          aiStopLoss: trade.ai_stop_loss,
          aiTarget: trade.ai_target,
          setup: trade.setup,
          strategyContext: trade.strategy_context ? JSON.parse(trade.strategy_context) : null,
        }),
        createdAt: now,
        updatedAt: now,
      })
      .execute()

    return id
  }

  async closeTrade(id: string, exitPrice: number, exitReason?: string, agentType?: string) {
    const now = new Date().toISOString()

    // Fetch the trade to calculate PnL
    const trade = await this.db.selectFrom('trades').selectAll().where('id', '=', id).executeTakeFirst()

    if (!trade) {
      throw new Error(`Trade with ID ${id} not found`)
    }

    const pnl = (exitPrice - Number(trade.entryPrice)) * trade.quantity

    await this.db
      .updateTable('trades')
      .set({
        exitPrice: String(exitPrice),
        pnl: String(pnl),
        status: 'CLOSED',
        closedAt: now,
        updatedAt: now,
      })
      .where('id', '=', id)
      .execute()

    // Insert Analytics Log (EXIT)
    const analyticsId = crypto.randomUUID()
    await this.db
      .insertInto('tradeAnalytics')
      .values({
        id: analyticsId,
        tradeId: id,
        eventType: 'EXIT',
        agentType: agentType || null,
        symbol: trade.symbol,
        side: trade.side === 'BUY' ? 'SELL' : 'BUY', // The closing action
        metadata: JSON.stringify({
          exitReason: exitReason || null,
        }),
        createdAt: now,
        updatedAt: now,
      })
      .execute()
  }

  async getOpenTrades(userId: string) {
    return await this.db
      .selectFrom('trades')
      .selectAll()
      .where('userId', '=', userId)
      .where('status', '=', 'OPEN')
      .execute()
  }

  async getTodaysTrades(userId: string) {
    const today = new Date().toISOString().split('T')[0] // YYYY-MM-DD
    return await this.db
      .selectFrom('trades')
      .selectAll()
      .where('userId', '=', userId)
      .where('openedAt', '>=', `${today}T00:00:00Z`)
      .orderBy('openedAt', 'asc')
      .execute()
  }

  async getAllTrades(userId: string) {
    const trades = await this.db
      .selectFrom('trades')
      .selectAll()
      .where('userId', '=', userId)
      .orderBy('openedAt', 'desc')
      .execute()

    if (trades.length === 0) return []

    const tradeIds = trades.map((t) => t.id)

    const analytics = await this.db.selectFrom('tradeAnalytics').selectAll().where('tradeId', 'in', tradeIds).execute()

    // Map analytics back to trades
    return trades.map((trade) => {
      const tradeEvents = analytics.filter((a) => a.tradeId === trade.id)
      const entryEvent = tradeEvents.find((a) => a.eventType === 'ENTRY')
      const exitEvent = tradeEvents.find((a) => a.eventType === 'EXIT')

      let aiReasoning,
        aiConfidence,
        vixLevel,
        rsiLevel,
        trend15m,
        aiStopLoss,
        aiTarget,
        setup,
        strategyContext,
        exitReason

      if (entryEvent?.metadata) {
        const meta = typeof entryEvent.metadata === 'string' ? JSON.parse(entryEvent.metadata) : entryEvent.metadata
        aiReasoning = meta.aiReasoning
        aiConfidence = meta.aiConfidence
        vixLevel = meta.vixLevel
        rsiLevel = meta.rsiLevel
        trend15m = meta.trend15m
        aiStopLoss = meta.aiStopLoss
        aiTarget = meta.aiTarget
        setup = meta.setup
        strategyContext = meta.strategyContext
      }

      if (exitEvent?.metadata) {
        const meta = typeof exitEvent.metadata === 'string' ? JSON.parse(exitEvent.metadata) : exitEvent.metadata
        exitReason = meta.exitReason
      }

      return {
        ...trade,
        aiReasoning,
        aiConfidence,
        vixLevel,
        rsiLevel,
        trend15m,
        aiStopLoss,
        aiTarget,
        setup,
        strategyContext,
        exitReason,
      }
    })
  }
}
