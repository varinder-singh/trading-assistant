import { db as dbDefault } from '../database.js'
import crypto from 'node:crypto'
import { Kysely } from 'kysely'
import type { Database } from '../database.js'

export interface AnalyzerEvent {
  symbol: string
  reason: string
  price: number
  timestamp: string
  metadata?: any
}

export class EventRepository {
  private db: Kysely<Database>

  constructor(db: Kysely<Database> = dbDefault) {
    this.db = db
  }

  async saveEvent(event: AnalyzerEvent) {
    const id = crypto.randomUUID()
    return await this.db
      .insertInto('marketEvents')
      .values({
        id,
        symbol: event.symbol,
        reason: event.reason,
        price: String(event.price),
        metadata: event.metadata ? JSON.stringify(event.metadata) : null,
        createdAt: event.timestamp,
        updatedAt: event.timestamp,
      })
      .executeTakeFirst()
  }

  async getRecentEvents(symbol: string, limit = 10) {
    return await this.db
      .selectFrom('marketEvents')
      .where('symbol', '=', symbol)
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .selectAll()
      .execute()
  }
}
