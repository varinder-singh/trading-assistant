import { Kysely } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('profiles')
    .addColumn('trade_mode', 'varchar', (col) => col.notNull().defaultTo('PAPER'))
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('profiles').dropColumn('trade_mode').execute()
}
