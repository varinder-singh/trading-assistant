import { Kysely } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('scanner_alerts')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('symbol', 'varchar', (col) => col.notNull())
    .addColumn('token', 'integer', (col) => col.notNull())
    .addColumn('price', 'numeric', (col) => col.notNull())
    .addColumn('atp', 'numeric', (col) => col.notNull())
    .addColumn('volume_surge_ratio', 'numeric', (col) => col.notNull())
    .addColumn('change_pct', 'numeric', (col) => col.notNull())
    .addColumn('obi', 'numeric', (col) => col.notNull())
    .addColumn('priority_score', 'numeric', (col) => col.notNull())
    .addColumn('status', 'varchar', (col) => col.notNull().defaultTo('PENDING'))
    .addColumn('trading_date', 'varchar', (col) => col.notNull())
    .addColumn('created_at', 'text', (col) => col.notNull())
    .addColumn('metadata', 'text')
    .execute()

  await db.schema
    .createIndex('idx_scanner_alerts_date')
    .ifNotExists()
    .on('scanner_alerts')
    .columns(['trading_date', 'priority_score'])
    .execute()

  await db.schema
    .createTable('active_analysis_snapshots')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('user_id', 'text', (col) => col.notNull())
    .addColumn('symbol', 'varchar', (col) => col.notNull())
    .addColumn('timeframe', 'varchar', (col) => col.notNull().defaultTo('15m'))
    .addColumn('support', 'numeric')
    .addColumn('resistance', 'numeric')
    .addColumn('vwap', 'numeric')
    .addColumn('atr', 'numeric')
    .addColumn('levels', 'text')
    .addColumn('decision', 'text')
    .addColumn('agent_deliberations', 'text')
    .addColumn('trading_date', 'varchar', (col) => col.notNull())
    .addColumn('updated_at', 'text', (col) => col.notNull())
    .execute()

  await db.schema
    .createIndex('idx_active_snapshots_user_symbol')
    .ifNotExists()
    .on('active_analysis_snapshots')
    .columns(['user_id', 'symbol', 'trading_date'])
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('active_analysis_snapshots').ifExists().execute()
  await db.schema.dropTable('scanner_alerts').ifExists().execute()
}
