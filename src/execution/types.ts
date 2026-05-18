export type OrderSide = "BUY" | "SELL";
export type OrderType = "MARKET" | "LIMIT" | "SL" | "SL-M";
export type OrderStatus = "PENDING" | "COMPLETE" | "REJECTED" | "CANCELLED";

export interface TradeOrder {
  id: string;
  symbol: string;
  token: number;
  side: OrderSide;
  quantity: number;
  price?: number;
  type: OrderType;
  status: OrderStatus;
  timestamp: Date;
}

export interface PaperPosition {
  symbol: string;
  token: number;
  side: OrderSide;
  quantity: number;
  avgEntryPrice: number;
  currentPrice: number;
  unrealizedPnL: number;
  realizedPnL: number;
  timestamp: Date;
}

export interface TradeResponse {
  success: boolean;
  orderId?: string;
  error?: string;
}
