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

export interface OpeningRange {
  high: number
  low: number
  broken?: "UP" | "DOWN" | "INSIDE"
}

export interface VolumeNode {
  price: number
  volume: number
}

export type ProfileType = "D" | "B" | "P" | "I" | "UNKNOWN"

export interface VolumeProfile {
  poc: number
  vah: number
  val: number
  profileType: ProfileType
  nodes: VolumeNode[]
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
  gtiScore?: import("./analysis.js").GTIScore
}

export type TradeTechnicalAnalysis = {
  tf1h: TechnicalAnalysis
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
  reversalScore?: {
    bullish: number
    bearish: number
  }
  lotSize?: number
}

export interface GTIScore {
  composite: number
  classification: string
  confidence: number
  components: Record<string, number>
}

export interface GTICandleData {
  candle: Candle
  gtiScore: GTIScore
}
