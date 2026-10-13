import type { Connect as KiteConnect } from 'kiteconnect'
import type { TradeResponse, OrderSide, OrderType } from './types.js'

export class KiteOrderService {
  private maxQuantity = 5000 // Strict catastrophic risk limit (allows 9 lots of 550 shares for stock options)
  private inFlightOrders: Set<string> = new Set()

  constructor(private readonly kc: KiteConnect) {}

  public async placeOrder(params: {
    symbol: string
    side: OrderSide
    quantity: number
    type: OrderType
    price?: number
  }): Promise<TradeResponse> {
    const lockKey = `${params.side}_${params.symbol}`
    if (this.inFlightOrders.has(lockKey)) {
      console.log(`❌ [KITE TRADE] Order already in-flight for ${lockKey}. Rejecting duplicate.`)
      return { success: false, error: 'Order already in progress' }
    }
    this.inFlightOrders.add(lockKey)

    try {
      if (params.quantity > this.maxQuantity) {
        return {
          success: false,
          error: `Risk Limit Exceeded: Max catastrophic quantity is ${this.maxQuantity} shares`,
        }
      }

      const exchange = params.symbol.includes('-') ? 'NFO' : 'NSE'
      const orderParams: Record<string, any> = {
        exchange,
        tradingsymbol: params.symbol,
        transaction_type: params.side,
        quantity: params.quantity,
        order_type: params.type,
        product: 'MIS',
        ...(params.price ? { price: params.price } : {}),
      }

      const response = await this.kc.placeOrder('regular', orderParams)

      return {
        success: true,
        orderId: response.order_id,
      }
    } catch (error: any) {
      console.error('❌ Kite Order Placement Failed:', error.message || error)
      return {
        success: false,
        error: error.message || 'Unknown error during order placement',
      }
    } finally {
      this.inFlightOrders.delete(lockKey)
    }
  }

  public async getOrderStatus(orderId: string): Promise<any> {
    return this.kc.getOrderHistory(orderId)
  }
}
