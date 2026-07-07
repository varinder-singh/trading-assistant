import { db as dbDefault } from '../database.js'
import type { GTIScore } from '../../types/analysis.js'
import crypto from 'node:crypto'
import { Kysely } from 'kysely'
import type { Database } from '../database.js'

export interface SaveScoreData {
  symbol: string
  token: number
  timeframe: number
  candleTime: number
  candle: { open: number; high: number; low: number; close: number; volume: number }
  gtiScore: GTIScore
}

export class GtiRepository {
  private db: Kysely<Database>

  constructor(db: Kysely<Database> = dbDefault) {
    this.db = db
  }

  /**
   * Save a GTI score for a completed candle.
   */
  async saveScore(data: SaveScoreData) {
    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    return await this.db
      .insertInto('gtiScores')
      .values({
        id,
        symbol: data.symbol,
        token: data.token,
        timeframe: data.timeframe,
        candleTime: data.candleTime,
        open: data.candle.open,
        high: data.candle.high,
        low: data.candle.low,
        close: data.candle.close,
        volume: data.candle.volume,
        compositeScore: data.gtiScore.composite,
        classification: data.gtiScore.classification,
        confidence: data.gtiScore.confidence,
        components: JSON.stringify(data.gtiScore.components),
        timestamp: now,
      })
      .executeTakeFirst()
  }

  /**
   * Get recent GTI scores for a symbol and timeframe, ordered by candleTime desc.
   */
  async getScoresBySymbol(symbol: string, timeframe: number, limit = 50) {
    return await this.db
      .selectFrom('gtiScores')
      .where('symbol', '=', symbol)
      .where('timeframe', '=', timeframe)
      .orderBy('candleTime', 'desc')
      .limit(limit)
      .selectAll()
      .execute()
  }

  /**
   * Get all GTI scores for a symbol on a specific date (YYYY-MM-DD).
   * Useful for post-market review.
   */
  async getScoresForDate(symbol: string, date: string) {
    return await this.db
      .selectFrom('gtiScores')
      .where('symbol', '=', symbol)
      .where('timestamp', '>=', `${date}T00:00:00`)
      .where('timestamp', '<', `${date}T23:59:60`)
      .orderBy('candleTime', 'asc')
      .selectAll()
      .execute()
  }
}
