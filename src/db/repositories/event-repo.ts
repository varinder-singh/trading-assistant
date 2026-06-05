import { db } from "../database.js"
import { randomUUID } from "node:crypto"

export interface AnalyzerEvent {
  symbol: string
  reason: string
  price: number
  timestamp: string
  metadata?: any
}

export const eventRepo = {
  async saveEvent(event: AnalyzerEvent) {
    const id = randomUUID()
    return await db
      .insertInto("analyzer_events")
      .values({
        id,
        symbol: event.symbol,
        reason: event.reason,
        price: event.price,
        timestamp: event.timestamp,
        metadata: event.metadata ? JSON.stringify(event.metadata) : null,
      })
      .executeTakeFirst()
  },

  async getRecentEvents(symbol: string, limit = 10) {
    return await db
      .selectFrom("analyzer_events")
      .where("symbol", "=", symbol)
      .orderBy("timestamp", "desc")
      .limit(limit)
      .selectAll()
      .execute()
  },
}
