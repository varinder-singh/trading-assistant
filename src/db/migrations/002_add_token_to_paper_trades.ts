import { Kysely } from "kysely";

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable("paper_trades")
    .addColumn("token", "integer")
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable("paper_trades")
    .dropColumn("token")
    .execute();
}
