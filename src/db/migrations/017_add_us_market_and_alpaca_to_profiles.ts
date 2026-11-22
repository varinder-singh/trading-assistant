import { Kysely } from 'kysely'

/**
 * Migration 017: Add US Market (Alpaca) configuration to Profiles.
 *
 * Adds:
 * - enable_us_market: boolean (default false) to profiles table
 * - alpaca_trading_mode: 'PAPER' | 'LIVE' (default 'PAPER') to profiles table
 */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('profiles')
    .addColumn('enable_us_market', 'boolean', (col) => col.defaultTo(false))
    .addColumn('alpaca_trading_mode', 'varchar', (col) => col.defaultTo('PAPER'))
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('profiles')
    .dropColumn('enable_us_market')
    .dropColumn('alpaca_trading_mode')
    .execute()
}
