import { Kysely } from "kysely"

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable("paper_trades")
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("symbol", "text", (col) => col.notNull())
    .addColumn("side", "text", (col) => col.notNull())
    .addColumn("quantity", "integer", (col) => col.notNull())
    .addColumn("entry_price", "real", (col) => col.notNull())
    .addColumn("exit_price", "real")
    .addColumn("pnl", "real")
    .addColumn("status", "text", (col) => col.notNull().defaultTo("OPEN"))
    .addColumn("ai_reasoning", "text")
    .addColumn("ai_confidence", "real")
    .addColumn("vix_level", "real")
    .addColumn("rsi_level", "real")
    .addColumn("trend_15m", "text")
    .addColumn("opened_at", "text", (col) => col.notNull())
    .addColumn("closed_at", "text")
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable("paper_trades").execute()
}
