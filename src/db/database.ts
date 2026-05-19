import SQLite from "better-sqlite3";
import { Kysely, SqliteDialect } from "kysely";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { mkdirSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = resolve(__dirname, "../../data/trading.db");

// Ensure data directory exists
mkdirSync(dirname(dbPath), { recursive: true });

export interface PaperTradesTable {
  id: string; // UUID or custom ID
  symbol: string;
  side: "BUY" | "SELL";
  quantity: number;
  entry_price: number;
  exit_price: number | null;
  pnl: number | null;
  status: "OPEN" | "CLOSED";
  ai_reasoning: string | null;
  ai_confidence: number | null;
  vix_level: number | null;
  rsi_level: number | null;
  trend_15m: string | null;
  opened_at: string; // ISO string
  closed_at: string | null; // ISO string
}

export interface Database {
  paper_trades: PaperTradesTable;
}

export const db = new Kysely<Database>({
  dialect: new SqliteDialect({
    database: new SQLite(dbPath),
  }),
});
