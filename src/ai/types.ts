import type { KiteOptionsAnalysis } from "../analysis/kite-options.js"
import type { VixData } from "../data/vix.js"
import type { TechnicalAnalysis } from "../types/analysis.js"
import type { MarketMode } from "../types/mode.js"
import type { DailyContext } from "../types/technical-analysis.js"

export interface LLMMessage {
  role: "system" | "user" | "assistant"
  content: string
}

export interface LLMOptions {
  model?: string
  temperature?: number
}

export interface LLMProvider {
  name: string
  chat(messages: LLMMessage[], options?: LLMOptions): Promise<string>
}

export type TradingAgentType = "SCALPER" | "TREND"

export type AgentStatus = "thinking" | "decided" | "idle" | "error"

export interface AgentUpdate {
  agent: string
  status: AgentStatus
  message: string
  data?: any
}

export interface OrchestratorResponse {
  activeAgent: TradingAgentType
  confidence: number
  rationale: string
}

export type MarketContext = {
  tf1h: TechnicalAnalysis
  tf30m: TechnicalAnalysis
  tf15m: TechnicalAnalysis
  tf3m: TechnicalAnalysis
  dailyContext: DailyContext | null
  optionsAnalysisZerodha: KiteOptionsAnalysis
  vix: VixData
  mode: MarketMode
  time: string
}
export type AIDecision = "BUY" | "SELL" | "NO_TRADE" | "HOLD"
export type AIMarketActivitySetup = "TRUE_BREAKOUT" | "INSTITUTIONAL_TRAP" | "TREND_CONTINUATION" | "NONE"
export type AIMacroTrend = "COMPRESSION_BULLISH" | "EXPANDING_BEARISH" | "SIDEWAYS"
export type AIInstrument = "OPTIONS"
export type AIOptionAction = "BUY_CE" | "BUY_PE" | "NONE"

export interface AISuccessResponse {
  decision: AIDecision
  setup: AIMarketActivitySetup
  macroTrend: AIMacroTrend | string
  instrument: AIInstrument
  optionAction: AIOptionAction
  strike: number | null
  reason: string // "<2-3 sentences citing technicals AND specific OI/buildup signals>",
  confidence: number // <0-100>,
  entry: number // - Current Index Price or Breakout Level>,
  stopLoss: number // - ACTUAL INDEX LEVEL FOR INVALIDATION>,
  targets: number[]
  riskRewardRatio: number //<e.g. 1.5 or 2.0>
}

export interface TechnicalAgentResponse {
  bias: "BULLISH" | "BEARISH" | "NEUTRAL"
  setup: AIMarketActivitySetup
  waveContext: {
    currentWave: string
    description: string
  }
  confidence: number
  keyLevels: {
    support: number
    resistance: number
  }
  reason: string
}

export interface OptionsAgentResponse {
  bias: "BULLISH" | "BEARISH" | "NEUTRAL"
  confidence: number
  signals: string[]
  pcr: number
  oiWall: {
    resistance: number
    support: number
  }
  reason: string
}

export interface AIFailureResponse {
  decision: string
  reason: string
  confidence: number
}

// AI Sentiment
export type AISentimentSetup = "positive" | "negative" | "neutral"
export type AISentimentResponse = {
  sentiment: AISentimentSetup
  confidence: number //<0.0 to 1.0>,
  reason: string // "<1-2 sentences citing the key headline(s) that drove the assessment>";
}
