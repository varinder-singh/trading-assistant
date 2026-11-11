import { db as dbDefault, type Database } from '../database.js'
import crypto from 'node:crypto'
import { Kysely } from 'kysely'

export interface ScannerAlertRecord {
  id?: string
  symbol: string
  token: number
  price: number
  atp: number
  volumeSurgeRatio: number
  changePct: number
  obi: number
  priorityScore: number
  status?: 'PENDING' | 'ANALYZED' | 'TRADED' | 'EXPIRED' | string
  tradingDate: string
  createdAt?: string
  metadata?: any
}

export class ScannerAlertRepository {
  constructor(private readonly db: Kysely<Database> = dbDefault) {}

  public async saveAlert(alert: ScannerAlertRecord): Promise<string> {
    const id = alert.id || crypto.randomUUID()
    const now = alert.createdAt || new Date().toISOString()

    await this.db
      .insertInto('scannerAlerts')
      .values({
        id,
        symbol: alert.symbol,
        token: alert.token,
        price: String(alert.price),
        atp: String(alert.atp),
        volumeSurgeRatio: String(alert.volumeSurgeRatio),
        changePct: String(alert.changePct),
        obi: String(alert.obi),
        priorityScore: String(alert.priorityScore),
        status: alert.status || 'PENDING',
        tradingDate: alert.tradingDate,
        createdAt: now,
        metadata: alert.metadata ? JSON.stringify(alert.metadata) : null,
      })
      .executeTakeFirst()

    return id
  }

  public async updateStatus(id: string, status: string, metadata?: any): Promise<void> {
    const updateValues: Record<string, any> = { status }
    if (metadata !== undefined) {
      updateValues.metadata = JSON.stringify(metadata)
    }

    await this.db
      .updateTable('scannerAlerts')
      .set(updateValues)
      .where('id', '=', id)
      .execute()
  }

  public async getTodayAlerts(tradingDate: string, limit = 50) {
    const rows = await this.db
      .selectFrom('scannerAlerts')
      .where('tradingDate', '=', tradingDate)
      .orderBy('priorityScore', 'desc')
      .limit(limit)
      .selectAll()
      .execute()

    return rows.map((r) => this.mapRowToAlert(r))
  }

  private mapRowToAlert(r: any) {
    return {
      id: r.id,
      symbol: r.symbol,
      token: Number(r.token),
      price: Number(r.price),
      atp: Number(r.atp),
      volumeSurgeRatio: Number(r.volumeSurgeRatio),
      changePct: Number(r.changePct),
      obi: Number(r.obi),
      priorityScore: Number(r.priorityScore),
      status: r.status,
      tradingDate: r.tradingDate,
      createdAt: r.createdAt,
      metadata: r.metadata ? JSON.parse(r.metadata) : null,
    }
  }
}
