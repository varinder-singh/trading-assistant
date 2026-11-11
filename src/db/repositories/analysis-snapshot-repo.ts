import { db as dbDefault, type Database } from '../database.js'
import crypto from 'node:crypto'
import { Kysely } from 'kysely'

export interface AnalysisSnapshotRecord {
  id?: string
  userId: string
  symbol: string
  timeframe?: string
  support?: number | null | undefined
  resistance?: number | null | undefined
  vwap?: number | null | undefined
  atr?: number | null | undefined
  levels?: any
  decision?: any
  agentDeliberations?: any
  tradingDate: string
  updatedAt?: string
}

export class AnalysisSnapshotRepository {
  constructor(private readonly db: Kysely<Database> = dbDefault) {}

  public async saveSnapshot(snapshot: AnalysisSnapshotRecord): Promise<string> {
    const now = snapshot.updatedAt || new Date().toISOString()
    const upperSymbol = snapshot.symbol.toUpperCase().trim()

    const existing = await this.db
      .selectFrom('activeAnalysisSnapshots')
      .where('userId', '=', snapshot.userId)
      .where('symbol', '=', upperSymbol)
      .where('tradingDate', '=', snapshot.tradingDate)
      .select('id')
      .executeTakeFirst()

    if (existing) {
      await this.updateExistingSnapshot(existing.id, snapshot, now)
      return existing.id
    }

    const id = snapshot.id || crypto.randomUUID()
    await this.insertNewSnapshot(id, snapshot, upperSymbol, now)
    return id
  }

  public async getLatestSnapshot(userId: string, symbol: string): Promise<AnalysisSnapshotRecord | null> {
    const upperSymbol = symbol.toUpperCase().trim()

    const row = await this.db
      .selectFrom('activeAnalysisSnapshots')
      .where('userId', '=', userId)
      .where('symbol', '=', upperSymbol)
      .orderBy('updatedAt', 'desc')
      .limit(1)
      .selectAll()
      .executeTakeFirst()

    if (!row) return null

    return this.mapRowToSnapshot(row)
  }

  private async updateExistingSnapshot(id: string, s: AnalysisSnapshotRecord, now: string): Promise<void> {
    await this.db
      .updateTable('activeAnalysisSnapshots')
      .set({
        timeframe: s.timeframe || '15m',
        support: s.support !== undefined && s.support !== null ? String(s.support) : null,
        resistance: s.resistance !== undefined && s.resistance !== null ? String(s.resistance) : null,
        vwap: s.vwap !== undefined && s.vwap !== null ? String(s.vwap) : null,
        atr: s.atr !== undefined && s.atr !== null ? String(s.atr) : null,
        levels: s.levels ? JSON.stringify(s.levels) : null,
        decision: s.decision ? JSON.stringify(s.decision) : null,
        agentDeliberations: s.agentDeliberations ? JSON.stringify(s.agentDeliberations) : null,
        updatedAt: now,
      })
      .where('id', '=', id)
      .execute()
  }

  private async insertNewSnapshot(id: string, s: AnalysisSnapshotRecord, symbol: string, now: string): Promise<void> {
    await this.db
      .insertInto('activeAnalysisSnapshots')
      .values({
        id,
        userId: s.userId,
        symbol,
        timeframe: s.timeframe || '15m',
        support: s.support !== undefined && s.support !== null ? String(s.support) : null,
        resistance: s.resistance !== undefined && s.resistance !== null ? String(s.resistance) : null,
        vwap: s.vwap !== undefined && s.vwap !== null ? String(s.vwap) : null,
        atr: s.atr !== undefined && s.atr !== null ? String(s.atr) : null,
        levels: s.levels ? JSON.stringify(s.levels) : null,
        decision: s.decision ? JSON.stringify(s.decision) : null,
        agentDeliberations: s.agentDeliberations ? JSON.stringify(s.agentDeliberations) : null,
        tradingDate: s.tradingDate,
        updatedAt: now,
      })
      .executeTakeFirst()
  }

  private mapRowToSnapshot(row: any): AnalysisSnapshotRecord {
    return {
      id: row.id,
      userId: row.userId,
      symbol: row.symbol,
      timeframe: row.timeframe,
      support: row.support !== null ? Number(row.support) : null,
      resistance: row.resistance !== null ? Number(row.resistance) : null,
      vwap: row.vwap !== null ? Number(row.vwap) : null,
      atr: row.atr !== null ? Number(row.atr) : null,
      levels: row.levels ? JSON.parse(row.levels) : null,
      decision: row.decision ? JSON.parse(row.decision) : null,
      agentDeliberations: row.agentDeliberations ? JSON.parse(row.agentDeliberations) : null,
      tradingDate: row.tradingDate,
      updatedAt: row.updatedAt,
    }
  }
}
