import { Kysely, sql } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('iv_history')
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('symbol', 'text', (col) => col.notNull())
    .addColumn('date', 'text', (col) => col.notNull())
    .addColumn('iv', 'real', (col) => col.notNull())
    .addColumn('created_at', 'text', (col) => col.notNull())
    .addUniqueConstraint('iv_history_symbol_date_unique', ['symbol', 'date'])
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('iv_history').execute()
}
