export type OrderSide = 'BUY' | 'SELL'
export type OrderType = 'MARKET' | 'LIMIT' | 'SL' | 'SL-M'
export type OrderStatus = 'PENDING' | 'COMPLETE' | 'REJECTED' | 'CANCELLED'

export interface TradeOrder {
  id: string
  symbol: string
  token: number
  strike?: number
  side: OrderSide
  quantity: number
  price?: number
  type: OrderType
  status: OrderStatus
  timestamp: Date
}

export interface PaperPosition {
  symbol: string
  token: number
  strike?: number
  side: OrderSide
  quantity: number
  avgEntryPrice: number
  currentPrice: number
  unrealizedPnL: number
  realizedPnL: number
  aiStopLoss?: number
  aiTarget?: number
  // Tiered Profit Ladder
  t1Target?: number // Quick profit trigger (DTE-aware)
  t2Target?: number // Core profit trigger
  t3Target?: number // Hard exit trigger
  t1Hit?: boolean // T1 already triggered
  t2Hit?: boolean // T2 already triggered
  t1Qty?: number // Qty (whole lots) to sell at T1 (0 for 1-lot: just moves SL)
  t2Qty?: number // Qty (whole lots) to sell at T2
  aiSetup?: string
  strategyContext?: any
  optionDelta?: number | undefined
  optionTheta?: number | undefined
  optionVega?: number | undefined
  optionExpiry?: Date | string
  timestamp: Date
}

export interface TradeResponse {
  success: boolean
  orderId?: string
  error?: string | undefined
}
