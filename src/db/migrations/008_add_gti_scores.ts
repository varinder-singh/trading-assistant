import { Kysely, sql } from "kysely"

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable("gti_scores")
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("symbol", "text", (col) => col.notNull())
    .addColumn("token", "integer", (col) => col.notNull())
    .addColumn("timeframe", "integer", (col) => col.notNull())
    .addColumn("candle_time", "integer", (col) => col.notNull())
    .addColumn("open", "real", (col) => col.notNull())
    .addColumn("high", "real", (col) => col.notNull())
    .addColumn("low", "real", (col) => col.notNull())
    .addColumn("close", "real", (col) => col.notNull())
    .addColumn("volume", "real", (col) => col.notNull())
    .addColumn("composite_score", "real", (col) => col.notNull())
    .addColumn("classification", "text", (col) => col.notNull())
    .addColumn("confidence", "real", (col) => col.notNull())
    .addColumn("components", "text")
    .addColumn("timestamp", "text", (col) => col.notNull())
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable("gti_scores").execute()
}
