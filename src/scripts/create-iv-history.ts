import { Kysely, PostgresDialect, sql } from 'kysely'
import pg from 'pg'
import 'dotenv/config'

const { Pool } = pg

const db = new Kysely<any>({
  dialect: new PostgresDialect({
    pool: new Pool({
      connectionString: process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL,
    }),
  }),
})

async function main() {
  try {
    await db.schema
      .createTable('iv_history')
      .addColumn('id', 'text', (col) => col.primaryKey())
      .addColumn('symbol', 'text', (col) => col.notNull())
      .addColumn('date', 'text', (col) => col.notNull())
      .addColumn('iv', 'real', (col) => col.notNull())
      .addColumn('created_at', 'text', (col) => col.notNull())
      .addUniqueConstraint('iv_history_symbol_date_unique', ['symbol', 'date'])
      .execute()
    console.log('iv_history table created successfully!')
  } catch (err: any) {
    if (err.message.includes('already exists')) {
      console.log('Table already exists, ignoring.')
    } else {
      console.error('Error creating table:', err)
    }
  }
  process.exit(0)
}

main()
