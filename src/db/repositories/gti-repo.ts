import { db } from "../database.js"
import type { GTIScore } from "../../types/analysis.js"
import crypto from "node:crypto"

export interface SaveScoreData {
  symbol: string
  token: number
  timeframe: number
  candleTime: number
  candle: { open: number; high: number; low: number; close: number; volume: number }
  gtiScore: GTIScore
}

export const gtiRepo = {
  /**
   * Save a GTI score for a completed candle.
   */
  async saveScore(data: SaveScoreData) {
    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    return await db
      .insertInto("historicalCandles")
      .values({
        id,
        symbol: data.symbol,
        instrumentToken: data.token,
        timeframe: data.timeframe,
        candleTime: String(data.candleTime),
        open: String(data.candle.open),
        high: String(data.candle.high),
        low: String(data.candle.low),
        close: String(data.candle.close),
        volume: String(data.candle.volume),
        compositeScore: String(data.gtiScore.composite),
        classification: data.gtiScore.classification,
        confidence: String(data.gtiScore.confidence),
        components: JSON.stringify(data.gtiScore.components),
        createdAt: now,
        updatedAt: now,
      })
      .executeTakeFirst()
  },

  /**
   * Get recent GTI scores for a symbol and timeframe, ordered by candleTime desc.
   */
  async getScoresBySymbol(symbol: string, timeframe: number, limit = 50) {
    return await db
      .selectFrom("historicalCandles")
      .where("symbol", "=", symbol)
      .where("timeframe", "=", timeframe)
      .orderBy("candleTime", "desc")
      .limit(limit)
      .selectAll()
      .execute()
  },

  /**
   * Get all GTI scores for a symbol on a specific date (YYYY-MM-DD).
   * Useful for post-market review.
   */
  async getScoresForDate(symbol: string, date: string) {
    // We assume candleTime is stored as a Unix timestamp or similar, or createdAt can be used.
    // If createdAt represents when it was inserted, we filter by createdAt.
    return await db
      .selectFrom("historicalCandles")
      .where("symbol", "=", symbol)
      .where("createdAt", ">=", `${date}T00:00:00`)
      .where("createdAt", "<", `${date}T23:59:60`)
      .orderBy("candleTime", "asc")
      .selectAll()
      .execute()
  },
}
