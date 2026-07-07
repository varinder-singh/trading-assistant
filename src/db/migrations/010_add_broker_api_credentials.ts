import { Kysely } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  // Add columns to broker_accounts for per-user Kite API isolation
  await db.schema
    .alterTable('broker_accounts')
    .addColumn('api_key', 'text')
    .addColumn('api_secret_encrypted', 'text')
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('broker_accounts').dropColumn('api_key').dropColumn('api_secret_encrypted').execute()
}
