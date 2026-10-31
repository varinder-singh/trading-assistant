import { Kysely, sql } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  // Alter candle_time to be a bigint to support millisecond timestamps
  // We use using candle_time::bigint to safely cast existing data
  await sql`ALTER TABLE gti_scores ALTER COLUMN candle_time TYPE bigint USING candle_time::bigint`.execute(db)
}

export async function down(db: Kysely<any>): Promise<void> {
  // Revert back to integer
  await sql`ALTER TABLE gti_scores ALTER COLUMN candle_time TYPE integer USING candle_time::integer`.execute(db)
}
