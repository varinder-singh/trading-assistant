import { Kysely } from "kysely";

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable("paper_trades")
    .addColumn("setup", "text")
    .execute();

  await db.schema
    .alterTable("paper_trades")
    .addColumn("strategy_context", "text")
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable("paper_trades")
    .dropColumn("setup")
    .execute();

  await db.schema
    .alterTable("paper_trades")
    .dropColumn("strategy_context")
    .execute();
}
