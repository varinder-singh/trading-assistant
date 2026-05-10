export type Analysis = {
  trend: string,
  support: number,
  resistance: number,
  vwap: number,
  vwapPosition: string,
  price: number,
}

export type TradePlan = {
  decision: "BUY" | "SELL" | "NO_TRADE"
  reason: string
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
