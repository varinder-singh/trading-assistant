import { db } from "../database.js"
import type { GTIScore } from "../../types/analysis.js"

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
    return await db
      .insertInto("gti_scores")
      .values({
        id,
        symbol: data.symbol,
        token: data.token,
        timeframe: data.timeframe,
        candle_time: data.candleTime,
        open: data.candle.open,
        high: data.candle.high,
        low: data.candle.low,
        close: data.candle.close,
        volume: data.candle.volume,
        composite_score: data.gtiScore.composite,
        classification: data.gtiScore.classification,
        confidence: data.gtiScore.confidence,
        components: JSON.stringify(data.gtiScore.components),
        timestamp: new Date().toISOString(),
      })
      .executeTakeFirst()
  },

  /**
   * Get recent GTI scores for a symbol and timeframe, ordered by candle_time desc.
   */
  async getScoresBySymbol(symbol: string, timeframe: number, limit = 50) {
    return await db
      .selectFrom("gti_scores")
      .where("symbol", "=", symbol)
      .where("timeframe", "=", timeframe)
      .orderBy("candle_time", "desc")
      .limit(limit)
      .selectAll()
      .execute()
  },

  /**
   * Get all GTI scores for a symbol on a specific date (YYYY-MM-DD).
   * Useful for post-market review.
   */
  async getScoresForDate(symbol: string, date: string) {
    // Date is expected as "YYYY-MM-DD". Filter by timestamp prefix.
    return await db
      .selectFrom("gti_scores")
      .where("symbol", "=", symbol)
      .where("timestamp", ">=", `${date}T00:00:00`)
      .where("timestamp", "<", `${date}T23:59:60`)
      .orderBy("candle_time", "asc")
      .selectAll()
      .execute()
  },
}
