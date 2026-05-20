import SQLite from "better-sqlite3";
import { Kysely, SqliteDialect } from "kysely";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { mkdirSync, existsSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));

function getDbPath() {
  if (process.env.DB_PATH) return process.env.DB_PATH;

  // Find the root by looking for '.trading-assistant-root' marker
  let currentDir = __dirname;
  while (currentDir !== dirname(currentDir)) {
    if (existsSync(join(currentDir, ".trading-assistant-root"))) {
      return resolve(currentDir, "data/trading.db");
    }
    currentDir = dirname(currentDir);
  }

  // Fallback to process.cwd() logic if marker not found
  const cwd = process.cwd();
  const root = (cwd.endsWith("/web") || cwd.endsWith("/web/")) ? resolve(cwd, "..") : cwd;
  return join(root, "data/trading.db");
}

const dbPath = getDbPath();

// Ensure data directory exists
mkdirSync(dirname(dbPath), { recursive: true });

export interface PaperTradesTable {
  id: string; // UUID or custom ID
  symbol: string;
  token: number | null;
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
