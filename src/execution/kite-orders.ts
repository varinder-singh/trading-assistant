import kc from "../data/kite.js"
import type { TradeResponse, OrderSide, OrderType } from "./types.js"

export class KiteOrderService {
  private maxLotSize = 1 // Strict risk limit: 1 lot only

  async placeOrder(params: {
    symbol: string
    side: OrderSide
    quantity: number
    type: OrderType
    price?: number
  }): Promise<TradeResponse> {
    try {
      // 1. Strict Risk Check
      if (params.quantity > this.maxLotSize) {
        return {
          success: false,
          error: `Risk Limit Exceeded: Max lot size is ${this.maxLotSize}`,
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

      const response = await kc.placeOrder("regular", orderParams)

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
    }
  }

  async getOrderStatus(orderId: string) {
    return await kc.getOrderHistory(orderId)
  }
}
