import { db } from "./src/db/database.js"
import { sql } from "kysely"

async function fix() {
  const existingFiles = [
    "001_initial_schema",
    "007_add_analyzer_events",
    "009_add_iv_history",
    "010_add_broker_api_credentials",
  ]
  for (const name of existingFiles) {
    try {
        await db.insertInto("kysely_migration" as any).values({
            name,
            timestamp: new Date().toISOString()
        }).execute()
        console.log(`Inserted ${name}`)
    } catch(e) {
        // Ignore duplicate key errors
        console.log(`Failed or already exists ${name}`)
    }
  }
  
  console.log("Fixed migration table")
  process.exit(0)
}
fix().catch(console.error)
