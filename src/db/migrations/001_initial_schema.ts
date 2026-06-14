import { Kysely, sql } from "kysely"

export async function up(db: Kysely<any>): Promise<void> {
  // We use native PostgreSQL uuid_generate_v4(), so ensure the extension exists
  await sql`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`.execute(db)

  // 1. users table is managed by Supabase Auth (auth.users), so we don't create it.

  // 2. profiles table
  await db.schema
    .createTable("profiles")
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`uuid_generate_v4()`))
    // In a real Supabase setup, this would reference auth.users(id), but for local/standalone
    // we just use a regular UUID until auth.users is available.
    .addColumn("full_name", "text")
    .addColumn("created_at", "timestamp", (col) => col.defaultTo(sql`now()`).notNull())
    .addColumn("updated_at", "timestamp", (col) => col.defaultTo(sql`now()`).notNull())
    .execute()

  // 3. broker_accounts table
  await db.schema
    .createTable("broker_accounts")
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`uuid_generate_v4()`))
    .addColumn("user_id", "uuid", (col) => col.references("profiles.id").onDelete("cascade").notNull())
    .addColumn("broker_name", "text", (col) => col.notNull())
    .addColumn("broker_user_id", "text", (col) => col.notNull())
    .addColumn("access_token", "text", (col) => col.notNull())
    .addColumn("public_token", "text")
    .addColumn("is_active", "boolean", (col) => col.defaultTo(true).notNull())
    .addColumn("created_at", "timestamp", (col) => col.defaultTo(sql`now()`).notNull())
    .addColumn("updated_at", "timestamp", (col) => col.defaultTo(sql`now()`).notNull())
    .execute()

  // 4. trades table
  await db.schema
    .createTable("trades")
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`uuid_generate_v4()`))
    .addColumn("user_id", "uuid", (col) => col.references("profiles.id").onDelete("cascade").notNull())
    .addColumn("broker_account_id", "uuid", (col) => col.references("broker_accounts.id").onDelete("set null"))
    .addColumn("is_paper_trade", "boolean", (col) => col.defaultTo(true).notNull())
    .addColumn("symbol", "text", (col) => col.notNull())
    .addColumn("instrument_token", "integer")
    .addColumn("strike_price", "numeric")
    .addColumn("side", "varchar(10)", (col) => col.notNull()) // 'BUY' or 'SELL'
    .addColumn("quantity", "integer", (col) => col.notNull())
    .addColumn("status", "varchar(20)", (col) => col.notNull()) // 'OPEN', 'CLOSED', 'REJECTED'
    .addColumn("entry_price", "numeric", (col) => col.notNull())
    .addColumn("exit_price", "numeric")
    .addColumn("pnl", "numeric")
    .addColumn("opened_at", "timestamp", (col) => col.defaultTo(sql`now()`).notNull())
    .addColumn("closed_at", "timestamp")
    .addColumn("created_at", "timestamp", (col) => col.defaultTo(sql`now()`).notNull())
    .addColumn("updated_at", "timestamp", (col) => col.defaultTo(sql`now()`).notNull())
    .execute()

  // 5. trade_analytics table (1-to-many event log)
  await db.schema
    .createTable("trade_analytics")
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`uuid_generate_v4()`))
    .addColumn("trade_id", "uuid", (col) => col.references("trades.id").onDelete("cascade"))
    .addColumn("event_type", "varchar(20)", (col) => col.notNull()) // 'ENTRY', 'EXIT', 'UPDATE_SL', 'HOLD'
    .addColumn("agent_type", "text") // Which agent made the decision
    .addColumn("symbol", "text", (col) => col.notNull())
    .addColumn("side", "varchar(10)", (col) => col.notNull())
    .addColumn("metadata", "jsonb", (col) => col.notNull().defaultTo("{}")) // Store ai_reasoning, vix_level, etc.
    .addColumn("created_at", "timestamp", (col) => col.defaultTo(sql`now()`).notNull())
    .addColumn("updated_at", "timestamp", (col) => col.defaultTo(sql`now()`).notNull())
    .execute()

  // 6. market_events table
  await db.schema
    .createTable("market_events")
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`uuid_generate_v4()`))
    .addColumn("symbol", "text", (col) => col.notNull())
    .addColumn("reason", "text", (col) => col.notNull())
    .addColumn("price", "numeric", (col) => col.notNull())
    .addColumn("metadata", "jsonb")
    .addColumn("created_at", "timestamp", (col) => col.defaultTo(sql`now()`).notNull())
    .addColumn("updated_at", "timestamp", (col) => col.defaultTo(sql`now()`).notNull())
    .execute()

  // 7. historical_candles table
  await db.schema
    .createTable("historical_candles")
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`uuid_generate_v4()`))
    .addColumn("symbol", "text", (col) => col.notNull())
    .addColumn("instrument_token", "integer", (col) => col.notNull())
    .addColumn("timeframe", "integer", (col) => col.notNull())
    .addColumn("candle_time", "bigint", (col) => col.notNull())
    .addColumn("open", "numeric", (col) => col.notNull())
    .addColumn("high", "numeric", (col) => col.notNull())
    .addColumn("low", "numeric", (col) => col.notNull())
    .addColumn("close", "numeric", (col) => col.notNull())
    .addColumn("volume", "numeric", (col) => col.notNull())
    .addColumn("composite_score", "numeric")
    .addColumn("classification", "text")
    .addColumn("confidence", "numeric")
    .addColumn("components", "jsonb")
    .addColumn("created_at", "timestamp", (col) => col.defaultTo(sql`now()`).notNull())
    .addColumn("updated_at", "timestamp", (col) => col.defaultTo(sql`now()`).notNull())
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable("historical_candles").execute()
  await db.schema.dropTable("market_events").execute()
  await db.schema.dropTable("trade_analytics").execute()
  await db.schema.dropTable("trades").execute()
  await db.schema.dropTable("broker_accounts").execute()
  await db.schema.dropTable("profiles").execute()
}
