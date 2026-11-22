import { db as dbDefault } from '../database.js'
import { Kysely } from 'kysely'
import type { Database } from '../database.js'
import { decryptSecret, encryptSecret } from '../../utils/crypto.js'

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
        'maxActivePositions',
        'maxIndexPositions',
        'maxDailyTrades',
        'enablePullbackEntry',
        'enableUsMarket',
        'alpacaTradingMode',
      ])
      .where('id', '=', userId)
      .executeTakeFirst()
  }

  public async getUserBrokerAccountByUserId(userId: string, brokerName: string = 'zerodha') {
    return this.db
      .selectFrom('brokerAccounts')
      .select(['id', 'accessToken', 'apiKey', 'apiSecretEncrypted', 'isActive', 'brokerName', 'brokerUserId'])
      .where('userId', '=', userId)
      .where('brokerName', '=', brokerName)
      .where('isActive', '=', true)
      .executeTakeFirst()
  }

  public async getAlpacaCredentials(userId: string): Promise<{
    apiKey: string
    secretKey: string
    paper: boolean
    isActive: boolean
  } | null> {
    const account = await this.db
      .selectFrom('brokerAccounts')
      .select(['apiKey', 'apiSecretEncrypted', 'accessToken', 'isActive'])
      .where('userId', '=', userId)
      .where('brokerName', '=', 'alpaca')
      .executeTakeFirst()

    if (!account || !account.apiKey || !account.apiSecretEncrypted) {
      return null
    }

    try {
      return {
        apiKey: account.apiKey,
        secretKey: decryptSecret(account.apiSecretEncrypted),
        paper: account.accessToken !== 'LIVE',
        isActive: account.isActive,
      }
    } catch {
      return null
    }
  }

  public async upsertAlpacaCredentials(
    userId: string,
    creds: {
      apiKey: string
      secretKey?: string
      paper?: boolean
      isActive?: boolean
    }
  ): Promise<void> {
    const existing = await this.db
      .selectFrom('brokerAccounts')
      .select(['id', 'apiSecretEncrypted'])
      .where('userId', '=', userId)
      .where('brokerName', '=', 'alpaca')
      .executeTakeFirst()

    const accessToken = creds.paper === false ? 'LIVE' : 'PAPER'
    const encryptedSecret = creds.secretKey ? encryptSecret(creds.secretKey) : existing?.apiSecretEncrypted

    if (existing) {
      await this.db
        .updateTable('brokerAccounts')
        .set({
          apiKey: creds.apiKey,
          ...(encryptedSecret ? { apiSecretEncrypted: encryptedSecret } : {}),
          accessToken,
          isActive: creds.isActive ?? true,
          updatedAt: new Date().toISOString(),
        })
        .where('id', '=', existing.id)
        .execute()
    } else {
      if (!encryptedSecret) {
        throw new Error('Alpaca API Secret is required when creating new Alpaca credentials.')
      }
      await this.db
        .insertInto('brokerAccounts')
        .values({
          id: crypto.randomUUID(),
          userId,
          brokerName: 'alpaca',
          brokerUserId: 'alpaca-user',
          accessToken,
          apiKey: creds.apiKey,
          apiSecretEncrypted: encryptedSecret,
          publicToken: null,
          isActive: creds.isActive ?? true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .execute()
    }
  }

  public async deleteBrokerAccount(userId: string, brokerName: string): Promise<boolean> {
    const result = await this.db
      .deleteFrom('brokerAccounts')
      .where('userId', '=', userId)
      .where('brokerName', '=', brokerName)
      .executeTakeFirst()

    return Number(result.numDeletedRows ?? 0) > 0
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
      maxActivePositions?: number
      maxIndexPositions?: number
      maxDailyTrades?: number
      enablePullbackEntry?: boolean
      enableUsMarket?: boolean
      alpacaTradingMode?: string
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
        ...(preferences.maxActivePositions !== undefined
          ? { maxActivePositions: preferences.maxActivePositions }
          : {}),
        ...(preferences.maxIndexPositions !== undefined
          ? { maxIndexPositions: preferences.maxIndexPositions }
          : {}),
        ...(preferences.maxDailyTrades !== undefined ? { maxDailyTrades: preferences.maxDailyTrades } : {}),
        ...(preferences.enablePullbackEntry !== undefined
          ? { enablePullbackEntry: preferences.enablePullbackEntry }
          : {}),
        ...(preferences.enableUsMarket !== undefined ? { enableUsMarket: preferences.enableUsMarket } : {}),
        ...(preferences.alpacaTradingMode !== undefined ? { alpacaTradingMode: preferences.alpacaTradingMode } : {}),
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
