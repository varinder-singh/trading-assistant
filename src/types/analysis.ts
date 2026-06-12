import type { AISentimentResponse, AISuccessResponse, TradingAgentType } from "../ai/types.js"
import type { KiteOptionsAnalysis } from "../analysis/kite-options.js"
import type { VixData } from "../data/vix.js"
import type { DailyContext } from "./technical-analysis.js"

export type Analysis = {
  trend: string
  support: number
  resistance: number
  vwap: number
  vwapPosition: string
  price: number
}

export type TradePlan = {
  decision: "BUY" | "SELL" | "NO_TRADE" | "NEUTRAL"
  reason?: string
  entry?: number
  stopLoss?: number
  targets?: number[]
  riskReward?: number
}

export interface Candle {
  open: number
  high: number
  low: number
  close: number
  volume: number
  time: number
}

export interface SwingPoint {
  type: "HIGH" | "LOW"
  price: number
  time: number
}

export interface WaveContext {
  wave1High?: number
  wave1Low?: number
  wave2Low?: number
  wave3High?: number
  wave4Low?: number
  wave5Target?: number
  currentPhase: "WAVE_1" | "WAVE_2" | "WAVE_3" | "WAVE_4" | "WAVE_5" | "ABC_CORRECTION" | "CONSOLIDATION"
  fibZones?: {
    fib382: number
    fib500: number
    fib618: number
  }
}

// GTI (Global Trading Intelligence) Types
export type GTIClassification =
  | "STRONG_INSTITUTIONAL_BUY"
  | "INSTITUTIONAL_BUY"
  | "NEUTRAL"
  | "INSTITUTIONAL_SELL"
  | "STRONG_INSTITUTIONAL_SELL"

export interface GTIScore {
  composite: number // -1.0 (distribution) to +1.0 (accumulation)
  components: {
    volumeAnomaly: number // Z-score signed by price direction
    cvd: number // Cumulative Volume Delta normalized (-1 to +1)
    vwapDeviation: number // Distance from VWAP as signal (-1 to +1)
    oiSignal: number // From options buildup states (-1 to +1)
    smartMoneyFlow: number // Session-timing weighted flow (-1 to +1)
  }
  classification: GTIClassification
  confidence: number // 0-100, reliability of the signal
}

export interface GTICandleData {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
  gtiScore: GTIScore
}

export interface OpeningRange {
  high: number
  low: number
  broken?: "UP" | "DOWN" | "INSIDE"
}

export type TechnicalAnalysis = {
  trend: string
  support: number
  resistance: number
  vwap: number
  vwapPosition: string
  price: number
  rsi: number
  timeframe?: string
  ema?: Record<string, number>
  swings?: SwingPoint[] | undefined
  waveContext?: WaveContext | undefined
  openingRange?: OpeningRange | undefined
  gtiScore?: GTIScore | undefined
}

export type TradeTechnicalAnalysis = {
  tf1h: TechnicalAnalysis
  tf30m: TechnicalAnalysis
  tf15m: TechnicalAnalysis
  tf3m: TechnicalAnalysis
  dailyContext: DailyContext | null
  aiDecision: AISuccessResponse | undefined
  vix: VixData
  sentiment: AISentimentResponse
  optionsAnalysis: KiteOptionsAnalysis
  candles1h: Candle[]
  candles30m: Candle[]
  candles15m: Candle[]
  candles3m: Candle[]
  agentType: TradingAgentType
  gtiHistory?: GTICandleData[]
}
