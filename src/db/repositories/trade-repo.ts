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
  constructor(private readonly db: Kysely<Database> = dbDefault) {}

  public async insertTrade(trade: NewPaperTradeInput) {
    const id = crypto.randomUUID()
    const now = new Date().toISOString()

    await this.db
      .insertInto('trades')
      .values({
        id,
        userId: trade.userId,
        brokerAccountId: null,
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

  public async closeTrade(
    id: string,
    exitPrice: number,
    exitReason?: string,
    agentType?: string,
    metrics?: { peakPrice?: number; maxUnrealizedPnL?: number }
  ) {
    const now = new Date().toISOString()
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

    const analyticsId = crypto.randomUUID()
    await this.db
      .insertInto('tradeAnalytics')
      .values({
        id: analyticsId,
        tradeId: id,
        eventType: 'EXIT',
        agentType: agentType || null,
        symbol: trade.symbol,
        side: trade.side === 'BUY' ? 'SELL' : 'BUY',
        metadata: JSON.stringify({
          exitReason: exitReason || null,
          peakPrice: metrics?.peakPrice ?? null,
          maxUnrealizedPnL: metrics?.maxUnrealizedPnL ?? null,
        }),
        createdAt: now,
        updatedAt: now,
      })
      .execute()
  }

  public async getOpenTrades(userId: string) {
    return this.db.selectFrom('trades').selectAll().where('userId', '=', userId).where('status', '=', 'OPEN').execute()
  }

  public async getTodaysTrades(userId: string) {
    const today = new Date().toISOString().split('T')[0]
    return this.db
      .selectFrom('trades')
      .selectAll()
      .where('userId', '=', userId)
      .where('openedAt', '>=', `${today}T00:00:00Z`)
      .orderBy('openedAt', 'asc')
      .execute()
  }

  public async getAllTrades(userId: string) {
    const trades = await this.db
      .selectFrom('trades')
      .selectAll()
      .where('userId', '=', userId)
      .orderBy('openedAt', 'desc')
      .execute()

    if (trades.length === 0) return []

    const tradeIds = trades.map((t) => t.id)
    const analytics = await this.db.selectFrom('tradeAnalytics').selectAll().where('tradeId', 'in', tradeIds).execute()

    return trades.map((trade) => {
      const tradeEvents = analytics.filter((a) => a.tradeId === trade.id)
      const entryEvent = tradeEvents.find((a) => a.eventType === 'ENTRY')
      const exitEvent = tradeEvents.find((a) => a.eventType === 'EXIT')
      const meta = this.extractAnalyticsMetadata(entryEvent, exitEvent)

      return {
        ...trade,
        ...meta,
      }
    })
  }

  private extractAnalyticsMetadata(entryEvent?: any, exitEvent?: any) {
    const entryMeta = entryEvent?.metadata
      ? typeof entryEvent.metadata === 'string'
        ? JSON.parse(entryEvent.metadata)
        : entryEvent.metadata
      : {}

    const exitMeta = exitEvent?.metadata
      ? typeof exitEvent.metadata === 'string'
        ? JSON.parse(exitEvent.metadata)
        : exitEvent.metadata
      : {}

    return {
      aiReasoning: entryMeta.aiReasoning,
      aiConfidence: entryMeta.aiConfidence,
      vixLevel: entryMeta.vixLevel,
      rsiLevel: entryMeta.rsiLevel,
      trend15m: entryMeta.trend15m,
      aiStopLoss: entryMeta.aiStopLoss,
      aiTarget: entryMeta.aiTarget,
      setup: entryMeta.setup,
      strategyContext: entryMeta.strategyContext,
      exitReason: exitMeta.exitReason,
    }
  }
}
