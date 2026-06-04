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
}
