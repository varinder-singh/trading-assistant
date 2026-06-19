import { db } from "./src/db/database.js";
async function fix() {
    try {
        await db.schema.alterTable("broker_accounts").addColumn("api_key", "text").addColumn("api_secret_encrypted", "text").execute();
    } catch(e) {}
    console.log("Done");
}
fix();
