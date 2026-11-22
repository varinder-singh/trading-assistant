import type { Candle } from '../types/analysis.js'

export type MarketId = 'NSE' | 'US_EQUITIES' | 'DAX' | 'CRYPTO_PERP' | (string & {})

export type MarketAssetClass =
  | 'EQUITY'
  | 'INDEX_OPTION'
  | 'STOCK_OPTION'
  | 'CRYPTO'
  | 'CRYPTO_PERP'
  | 'COMMODITY_FUTURES'
  | 'FOREX'

export interface SpecialSessionConfig {
  date: string // 'YYYY-MM-DD'
  openTime: string // 'HH:MM'
  closeTime: string // 'HH:MM'
  name: string
}

export interface VolatilityBenchmarkConfig {
  symbol: string
  name: string
  baseline: number
  elevatedThreshold: number
  circuitBreakerThreshold: number
}

export interface MarketScheduleConfig {
  id: MarketId
  name: string
  country: string
  timezone: string
  openTime: string // 'HH:MM' (24-hour in market timezone)
  closeTime: string // 'HH:MM' (24-hour in market timezone)
  is24x7?: boolean
  tradingDays?: number[] // 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat, 7=Sun. Default: [1,2,3,4,5]
  currency: string
  defaultContractMultiplier?: number
  squareOffMinutesBeforeClose?: number // Minutes before close for mandatory intraday square-off (e.g. 15 for NSE MIS)
  openingBellFilterMinutes?: number // Default 15
  closingBellFilterMinutes?: number // Default 15
  volatilityBenchmark: VolatilityBenchmarkConfig
  specialSessions?: SpecialSessionConfig[]
}

export interface IMarketSession {
  readonly id: MarketId
  readonly name: string
  readonly timezone: string
  readonly currency: string
  readonly is24x7: boolean
  readonly config: MarketScheduleConfig

  isMarketOpen(date?: Date): boolean
  isOpeningBellFilterActive(date?: Date): boolean
  isClosingBellFilterActive(date?: Date): boolean
  getTimeToCloseMinutes(date?: Date): number
  isRunwayConstrained(requiredMinutes: number, date?: Date): boolean
  getMarketStatusMessage(date?: Date): string
  formatLocalTime(date?: Date): string
  getVolatilityBenchmark(): VolatilityBenchmarkConfig
}

export interface MarketQuote {
  symbol: string
  price: number
  open?: number | undefined
  high?: number | undefined
  low?: number | undefined
  close?: number | undefined
  volume?: number | undefined
  timestamp: number
  currency: string
  bid?: number | undefined
  ask?: number | undefined
}

export interface MarketOrderRequest {
  symbol: string
  assetClass: MarketAssetClass
  side: 'BUY' | 'SELL'
  quantity: number
  orderType: 'MARKET' | 'LIMIT'
  price?: number | undefined
  triggerPrice?: number | undefined
  stopLossPrice?: number | undefined
  targetPrice?: number | undefined
  product?: 'MIS' | 'CNC' | 'PERPETUAL' | 'MARGIN' | string | undefined
}

export interface MarketOrderResponse {
  orderId: string
  symbol: string
  status: 'PENDING' | 'FILLED' | 'REJECTED' | 'CANCELLED'
  averagePrice?: number | undefined
  filledQuantity: number
  placedAt: number
  message?: string | undefined
}

export interface MarketPosition {
  symbol: string
  assetClass: MarketAssetClass
  side: 'BUY' | 'SELL'
  quantity: number
  entryPrice: number
  currentPrice: number
  unrealizedPnL: number
  realizedPnL: number
  openedAt: number
}

export interface IBrokerGateway {
  readonly brokerId: string
  readonly marketId: MarketId
  readonly brokerName?: string

  getQuote(symbol: string): Promise<MarketQuote>
  getHistoricalCandles(symbol: string, timeframe: string, count: number): Promise<Candle[]>
  placeOrder(order: MarketOrderRequest): Promise<MarketOrderResponse>
  cancelOrder(orderId: string): Promise<boolean>
  getPositions(): Promise<MarketPosition[]>
}
