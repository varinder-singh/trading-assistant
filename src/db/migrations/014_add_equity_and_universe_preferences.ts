import { Kysely } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('profiles')
    .addColumn('allowed_universes', 'varchar', (col) => col.defaultTo('INDEX_OPTIONS,EQUITY,STOCK_OPTIONS'))
    .addColumn('stock_option_preference', 'varchar', (col) => col.defaultTo('PREFER_OPTIONS_IF_LISTED'))
    .addColumn('equity_holding_mode', 'varchar', (col) => col.defaultTo('MIS'))
    .addColumn('equity_risk_per_trade', 'numeric', (col) => col.defaultTo(1500))
    .execute()

  await db.schema
    .alterTable('trades')
    .addColumn('product', 'varchar', (col) => col.defaultTo('MIS'))
    .addColumn('asset_class', 'varchar', (col) => col.defaultTo('INDEX_OPTION'))
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('profiles')
    .dropColumn('allowed_universes')
    .dropColumn('stock_option_preference')
    .dropColumn('equity_holding_mode')
    .dropColumn('equity_risk_per_trade')
    .execute()

  await db.schema
    .alterTable('trades')
    .dropColumn('product')
    .dropColumn('asset_class')
    .execute()
}
