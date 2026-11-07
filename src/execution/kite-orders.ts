import type { Connect as KiteConnect } from 'kiteconnect'
import type { TradeResponse, OrderSide, OrderType } from './types.js'

type KiteOrderParams = Parameters<KiteConnect['placeOrder']>[1]

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
    product?: 'MIS' | 'CNC'
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

      const response = await this.kc.placeOrder('regular', this.toKiteOrderParams(params))

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

  public async placeGTTOrder(params: {
    symbol: string
    quantity: number
    targetPrice: number
    stopLossPrice: number
    lastPrice: number
  }): Promise<{ success: boolean; triggerId?: number; error?: string }> {
    try {
      const isOption = params.symbol.endsWith('CE') || params.symbol.endsWith('PE')
      const exchange = isOption ? 'NFO' : 'NSE'
      const response = await (this.kc as any).placeGTT({
        trigger_type: (this.kc as any).GTT_TYPE_OCO || 'two-leg',
        tradingsymbol: params.symbol,
        exchange,
        trigger_values: [params.stopLossPrice, params.targetPrice],
        last_price: params.lastPrice,
        orders: [
          {
            transaction_type: 'SELL',
            quantity: params.quantity,
            order_type: 'LIMIT',
            product: 'CNC',
            price: params.stopLossPrice,
          },
          {
            transaction_type: 'SELL',
            quantity: params.quantity,
            order_type: 'LIMIT',
            product: 'CNC',
            price: params.targetPrice,
          },
        ],
      })
      return { success: true, triggerId: response?.trigger_id }
    } catch (err: any) {
      console.error(`❌ [GTT Placement Failed] for ${params.symbol}:`, err.message || err)
      return { success: false, error: err.message || 'GTT placement failed' }
    }
  }

  public async getOrderStatus(orderId: string): Promise<any> {
    return this.kc.getOrderHistory(orderId)
  }

  private toKiteOrderParams(params: {
    symbol: string
    side: OrderSide
    quantity: number
    type: OrderType
    price?: number
    product?: 'MIS' | 'CNC'
  }): KiteOrderParams {
    const isOptionOrFuture =
      params.symbol.endsWith('CE') ||
      params.symbol.endsWith('PE') ||
      params.symbol.includes('FUT') ||
      params.symbol.includes('-')

    return {
      exchange: isOptionOrFuture ? 'NFO' : 'NSE',
      tradingsymbol: params.symbol,
      transaction_type: params.side,
      quantity: params.quantity,
      order_type: params.type,
      product: params.product || 'MIS',
      ...(params.price ? { price: params.price } : {}),
    }
  }
}
