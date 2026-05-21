import { Kysely } from "kysely";

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable("paper_trades")
    .addColumn("ai_stop_loss", "real")
    .execute();

  await db.schema
    .alterTable("paper_trades")
    .addColumn("ai_target", "real")
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable("paper_trades")
    .dropColumn("ai_stop_loss")
    .execute();

  await db.schema
    .alterTable("paper_trades")
    .dropColumn("ai_target")
    .execute();
}
