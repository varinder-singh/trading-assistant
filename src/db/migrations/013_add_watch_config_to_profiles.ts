import { Kysely } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('profiles')
    .addColumn('watched_symbol', 'varchar')
    .addColumn('watched_mode', 'varchar', (col) => col.defaultTo('intraday'))
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('profiles')
    .dropColumn('watched_symbol')
    .dropColumn('watched_mode')
    .execute()
}
