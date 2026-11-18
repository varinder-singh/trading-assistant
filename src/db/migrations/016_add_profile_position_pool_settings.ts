import { Kysely } from 'kysely'

/**
 * Migration 016: Add User-Configurable Position & Trade Pool Settings to Profiles.
 *
 * Allows each user to own and balance their total intraday/swing position pool:
 * - max_active_positions: Total concurrent positions across all asset classes (default 10).
 * - max_index_positions: Dedicated slots reserved for NIFTY/BANKNIFTY index options (default 2)
 *   so index setups are never starved out when stock positions are active.
 * - max_daily_trades: Total daily trades permitted across the user's pool (default 30).
 * - enable_pullback_entry: When true, queues a wave-retracement limit entry slightly below
 *   the breakout spike top instead of chasing inflated market prices.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('profiles')
    .addColumn('max_active_positions', 'integer', (col) => col.defaultTo(10))
    .addColumn('max_index_positions', 'integer', (col) => col.defaultTo(2))
    .addColumn('max_daily_trades', 'integer', (col) => col.defaultTo(30))
    .addColumn('enable_pullback_entry', 'boolean', (col) => col.defaultTo(true))
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('profiles')
    .dropColumn('max_active_positions')
    .dropColumn('max_index_positions')
    .dropColumn('max_daily_trades')
    .dropColumn('enable_pullback_entry')
    .execute()
}
