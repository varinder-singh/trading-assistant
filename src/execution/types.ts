import type { AIMacroTrend, TradingAgentType } from '../ai/types.js'

export type OrderSide = 'BUY' | 'SELL'
export type OrderType = 'MARKET' | 'LIMIT' | 'SL' | 'SL-M'
export type OrderStatus = 'PENDING' | 'COMPLETE' | 'REJECTED' | 'CANCELLED'

export interface StrategyContext {
  macroTrend: AIMacroTrend
  isCompression?: boolean | undefined
  atr14?: number | undefined
  indexSl: number
  agentType: TradingAgentType
  reversalScore?: { bullish: number; bearish: number } | undefined
  riskRewardRatio?: number | undefined
}

export interface TradeContext {
  aiReasoning?: string | undefined
  aiConfidence?: number | undefined
  vixLevel?: number | undefined
  rsiLevel?: number | undefined
  trend15m?: string | undefined
  aiStopLoss?: number | undefined
  aiTarget?: number | undefined
  aiStrike?: number | undefined
  aiSetup?: string | undefined
  strategyContext?: StrategyContext | undefined
  optionDelta?: number | undefined
  optionTheta?: number | undefined
  optionVega?: number | undefined
  optionExpiry?: Date | string | undefined
  lotSize?: number | undefined
  aiIndexTargets?: number[] | undefined
  currentIndexPrice?: number | undefined
  optionRiskPoints?: number | undefined
  baseSignalPrice?: number | undefined
  triggerPrice?: number | undefined
  isTriggerOrder?: boolean | undefined
}

export interface PendingTriggerOrder {
  id: string
  symbol: string
  token: number
  strike?: number | undefined
  side: OrderSide
  quantity: number
  triggerPrice: number
  type: OrderType
  status: OrderStatus
  createdAt: Date
  expiresAt: Date
  ttlMs: number
  indexInvalidation?: number | undefined
  currentIndexPrice?: number | undefined
  optionRiskPoints?: number | undefined
  estimatedDelta?: number | undefined
  riskRewardRatio?: number | undefined
  baseSignalPrice?: number | undefined
  context?: TradeContext | undefined
}

export interface TradeOrder {
  id: string
  symbol: string
  token: number
  strike?: number | undefined
  side: OrderSide
  quantity: number
  price?: number | undefined
  type: OrderType
  status: OrderStatus
  timestamp: Date
}

export interface PaperPosition {
  symbol: string
  token: number
  strike?: number | undefined
  side: OrderSide
  quantity: number
  avgEntryPrice: number
  currentPrice: number
  unrealizedPnL: number
  realizedPnL: number
  peakPrice?: number | undefined // Highest price reached since entry (High-Watermark)
  maxUnrealizedPnL?: number | undefined // Highest unrealized PnL achieved during trade lifespan (MFE)
  trailingSlLocked?: number | undefined // Profit level locked by dynamic peak ratchet
  aiStopLoss?: number | undefined
  aiTarget?: number | undefined
  // Tiered Profit Ladder
  t1Target?: number | undefined // Quick profit trigger (DTE-aware)
  t2Target?: number | undefined // Core profit trigger
  t3Target?: number | undefined // Hard exit trigger
  t1Hit?: boolean | undefined // T1 already triggered
  t2Hit?: boolean | undefined // T2 already triggered
  t1Qty?: number | undefined // Qty (whole lots) to sell at T1 (0 for 1-lot: just moves SL)
  t2Qty?: number | undefined // Qty (whole lots) to sell at T2
  aiSetup?: string | undefined
  strategyContext?: any | undefined
  optionDelta?: number | undefined
  optionTheta?: number | undefined
  optionVega?: number | undefined
  optionExpiry?: Date | string | undefined
  indexInvalidation?: number | undefined // Underlying index level that invalidates the trade thesis (dual-track exit)
  timestamp: Date
}

export interface TradeResponse {
  success: boolean
  orderId?: string | undefined
  error?: string | undefined
}
