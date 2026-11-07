import { db as dbDefault } from '../database.js'
import { Kysely } from 'kysely'
import type { Database } from '../database.js'

export class UserRepository {
  constructor(private readonly db: Kysely<Database> = dbDefault) {}

  public async getUserProfileByUserId(userId: string) {
    return this.db
      .selectFrom('profiles')
      .select([
        'tradeMode',
        'watchedSymbol',
        'watchedMode',
        'allowedUniverses',
        'stockOptionPreference',
        'equityHoldingMode',
        'equityRiskPerTrade',
      ])
      .where('id', '=', userId)
      .executeTakeFirst()
  }

  public async getUserBrokerAccountByUserId(userId: string) {
    return this.db
      .selectFrom('brokerAccounts')
      .select(['accessToken', 'apiKey'])
      .where('userId', '=', userId)
      .where('isActive', '=', true)
      .executeTakeFirst()
  }

  public async getWatchConfig(userId: string) {
    return this.db
      .selectFrom('profiles')
      .select(['watchedSymbol', 'watchedMode'])
      .where('id', '=', userId)
      .executeTakeFirst()
  }

  public async updateWatchConfig(userId: string, symbol: string | null, mode: string | null) {
    await this.db
      .updateTable('profiles')
      .set({ watchedSymbol: symbol, watchedMode: mode })
      .where('id', '=', userId)
      .execute()
  }

  public async updateUniversePreferences(
    userId: string,
    preferences: {
      allowedUniverses?: string
      stockOptionPreference?: string
      equityHoldingMode?: string
      equityRiskPerTrade?: number
    }
  ) {
    await this.db
      .updateTable('profiles')
      .set({
        ...(preferences.allowedUniverses !== undefined ? { allowedUniverses: preferences.allowedUniverses } : {}),
        ...(preferences.stockOptionPreference !== undefined
          ? { stockOptionPreference: preferences.stockOptionPreference }
          : {}),
        ...(preferences.equityHoldingMode !== undefined
          ? { equityHoldingMode: preferences.equityHoldingMode }
          : {}),
        ...(preferences.equityRiskPerTrade !== undefined
          ? { equityRiskPerTrade: preferences.equityRiskPerTrade.toString() }
          : {}),
      })
      .where('id', '=', userId)
      .execute()
  }

  public async getActiveWatchingUsers() {
    return this.db
      .selectFrom('profiles')
      .innerJoin('brokerAccounts', 'brokerAccounts.userId', 'profiles.id')
      .select([
        'profiles.id as userId',
        'profiles.tradeMode',
        'profiles.watchedSymbol',
        'profiles.watchedMode',
        'brokerAccounts.accessToken',
        'brokerAccounts.apiKey',
      ])
      .where('brokerAccounts.isActive', '=', true)
      .where('profiles.watchedSymbol', 'is not', null)
      .execute()
  }
}
