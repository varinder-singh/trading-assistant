import { db as dbDefault } from '../database.js'
import { Kysely } from 'kysely'
import type { Database } from '../database.js'

export class UserRepository {
  private db: Kysely<Database>

  constructor(db: Kysely<Database> = dbDefault) {
    this.db = db
  }

  public async getUserProfileByUserId(userId: string) {
    return await this.db.selectFrom('profiles').select(['tradeMode']).where('id', '=', userId).executeTakeFirst()
  }

  public async getUserBrokerAccountByUserId(userId: string) {
    return await this.db
      .selectFrom('brokerAccounts')
      .select(['accessToken', 'apiKey'])
      .where('userId', '=', userId)
      .where('isActive', '=', true)
      .executeTakeFirst()
  }
}
