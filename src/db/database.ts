import { Kysely, PostgresDialect, CamelCasePlugin } from "kysely"
import pg from "pg"
import "dotenv/config"

const { Pool } = pg

export interface ProfilesTable {
  id: string
  fullName: string | null
  tradeMode: "PAPER" | "REAL"
  createdAt: string
  updatedAt: string
}

export interface BrokerAccountsTable {
  id: string
  userId: string
  brokerName: string
  brokerUserId: string
  accessToken: string
  publicToken: string | null
  apiKey: string | null
  apiSecretEncrypted: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface TradesTable {
  id: string
  userId: string
  brokerAccountId: string | null
  isPaperTrade: boolean
  symbol: string
  instrumentToken: number | null
  strikePrice: string | null // numeric mapped to string in pg by default
  side: "BUY" | "SELL"
  quantity: number
  status: "OPEN" | "CLOSED" | "REJECTED"
  entryPrice: string // numeric
  exitPrice: string | null // numeric
  pnl: string | null // numeric
  openedAt: string
  closedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface TradeAnalyticsTable {
  id: string
  tradeId: string | null
  eventType: "ENTRY" | "EXIT" | "UPDATE_SL" | "HOLD"
  agentType: string | null
  symbol: string
  side: "BUY" | "SELL"
  metadata: any // JSONB
  createdAt: string
  updatedAt: string
}

export interface MarketEventsTable {
  id: string
  symbol: string
  reason: string
  price: string // numeric
  metadata: any | null // JSONB
  createdAt: string
  updatedAt: string
}

export interface HistoricalCandlesTable {
  id: string
  symbol: string
  instrumentToken: number
  timeframe: number
  candleTime: string // bigint
  open: string // numeric
  high: string // numeric
  low: string // numeric
  close: string // numeric
  volume: string // numeric
  compositeScore: string | null // numeric
  classification: string | null
  confidence: string | null // numeric
  components: any | null // JSONB
  createdAt: string
  updatedAt: string
}

export interface GtiScoresTable {
  id: string
  symbol: string
  token: number
  timeframe: number
  candleTime: number
  open: number
  high: number
  low: number
  close: number
  volume: number
  compositeScore: number
  classification: string
  confidence: number
  components: string | null
  timestamp: string
}

export interface IvHistoryTable {
  id: string
  symbol: string
  date: string
  iv: number
  createdAt: string
}

export interface Database {
  profiles: ProfilesTable
  brokerAccounts: BrokerAccountsTable
  trades: TradesTable
  tradeAnalytics: TradeAnalyticsTable
  marketEvents: MarketEventsTable
  historicalCandles: HistoricalCandlesTable
  gtiScores: GtiScoresTable
  ivHistory: IvHistoryTable
}

const dbUrl = process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL

export const db = new Kysely<Database>({
  dialect: new PostgresDialect({
    pool: new Pool({
      connectionString: dbUrl,
    }),
  }),
  plugins: [new CamelCasePlugin()],
})
