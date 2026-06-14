import { db } from "../database.js"
import crypto from "node:crypto"

export interface AnalyzerEvent {
  symbol: string
  reason: string
  price: number
  timestamp: string
  metadata?: any
}

export const eventRepo = {
  async saveEvent(event: AnalyzerEvent) {
    const id = crypto.randomUUID()
    return await db
      .insertInto("marketEvents")
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
  },

  async getRecentEvents(symbol: string, limit = 10) {
    return await db
      .selectFrom("marketEvents")
      .where("symbol", "=", symbol)
      .orderBy("createdAt", "desc")
      .limit(limit)
      .selectAll()
      .execute()
  },
}
