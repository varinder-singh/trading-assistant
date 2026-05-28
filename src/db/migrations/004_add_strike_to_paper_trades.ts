import { Kysely } from "kysely"

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable("paper_trades").addColumn("strike_price", "real").execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable("paper_trades").dropColumn("strike_price").execute()
}
