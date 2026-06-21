import type { Connect as KiteConnect } from "kiteconnect"
import type { TradeResponse, OrderSide, OrderType } from "./types.js"

export class KiteOrderService {
  private maxQuantity = 5000 // Strict catastrophic risk limit (allows 9 lots of 550 shares for stock options)
  private kc: KiteConnect
  private inFlightOrders: Set<string> = new Set()

  constructor(kc: KiteConnect) {
    this.kc = kc
  }

  async placeOrder(params: {
    symbol: string
    side: OrderSide
    quantity: number
    type: OrderType
    price?: number
  }): Promise<TradeResponse> {
    const lockKey = `${params.side}_${params.symbol}`
    if (this.inFlightOrders.has(lockKey)) {
      console.log(`❌ [KITE TRADE] Order already in-flight for ${lockKey}. Rejecting duplicate.`)
      return { success: false, error: "Order already in progress" }
    }
    this.inFlightOrders.add(lockKey)

    try {
      // 1. Strict Catastrophic Risk Check (Business logic handles lot sizing)
      if (params.quantity > this.maxQuantity) {
        return {
          success: false,
          error: `Risk Limit Exceeded: Max catastrophic quantity is ${this.maxQuantity} shares`,
        }
      }

      // 2. Resolve Segment
      const exchange = params.symbol.includes("-") ? "NFO" : "NSE"

      // 3. Place Order via Kite API
      const orderParams: any = {
        exchange,
        tradingsymbol: params.symbol,
        transaction_type: params.side,
        quantity: params.quantity,
        order_type: params.type,
        product: "MIS", // Intraday
      }

      if (params.price) {
        orderParams.price = params.price
      }

      const response = await this.kc.placeOrder("regular", orderParams)

      return {
        success: true,
        orderId: response.order_id,
      }
    } catch (error: any) {
      console.error("❌ Kite Order Placement Failed:", error.message || error)
      return {
        success: false,
        error: error.message || "Unknown error during order placement",
      }
    } finally {
      this.inFlightOrders.delete(lockKey)
    }
  }

  async getOrderStatus(orderId: string) {
    return await this.kc.getOrderHistory(orderId)
  }
}
