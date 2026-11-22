import { Alpaca } from '@alpacahq/alpaca-trade-api'
import { BaseBrokerAdapter } from '../broker-gateway.js'
import type {
  MarketId,
  MarketOrderRequest,
  MarketOrderResponse,
  MarketPosition,
  MarketQuote,
} from '../types.js'
import type { Candle } from '../../types/analysis.js'
import { createLogger } from '../../utils/logger.js'

const log = createLogger('AlpacaAdapter')

export interface AlpacaAdapterConfig {
  apiKey?: string
  secretKey?: string
  paper?: boolean
  marketId?: MarketId
  alpacaClient?: any // Dependency injection for unit testing
}

export class AlpacaBrokerAdapter extends BaseBrokerAdapter {
  private readonly client: any
  public readonly isPaper: boolean

  constructor(config: AlpacaAdapterConfig = {}) {
    const marketId: MarketId = config.marketId ?? 'US_EQUITIES'
    super('ALPACA', marketId, 'AlpacaBrokerAdapter')

    this.isPaper = config.paper ?? true

    if (config.alpacaClient) {
      this.client = config.alpacaClient
    } else {
      const keyId =
        config.apiKey ||
        process.env.ALPACA_API_KEY_ID ||
        process.env.APCA_API_KEY_ID ||
        ''
      const secret =
        config.secretKey ||
        process.env.ALPACA_API_SECRET_KEY ||
        process.env.APCA_API_SECRET_KEY ||
        ''

      if (!keyId || !secret) {
        log.warn(
          'Alpaca API credentials missing. Running in mock/unauthenticated mode. Set APCA_API_KEY_ID and APCA_API_SECRET_KEY.'
        )
      }

      this.client = new Alpaca({
        keyId: keyId || 'MOCK_KEY',
        secret: secret || 'MOCK_SECRET',
        paper: this.isPaper,
      })
    }
  }

  public override async getQuote(symbol: string): Promise<MarketQuote> {
    try {
      const [barRes, quoteRes] = await Promise.all([
        this.client.marketData.stocks.stockLatestBarSingle({ symbol }),
        this.client.marketData.stocks.stockLatestQuoteSingle({ symbol }).catch(() => null),
      ])

      const bar = barRes?.bar ?? barRes
      const quote = quoteRes?.quote ?? quoteRes

      const price = Number(bar?.close ?? bar?.c ?? quote?.ask_price ?? quote?.ap ?? 0)
      const bid = Number(quote?.bid_price ?? quote?.bp ?? price)
      const ask = Number(quote?.ask_price ?? quote?.ap ?? price)
      const volume = Number(bar?.volume ?? bar?.v ?? 0)
      const timestamp = bar?.timestamp
        ? new Date(bar.timestamp).getTime()
        : Date.now()

      return {
        symbol: symbol.toUpperCase(),
        price,
        open: bar?.open ?? bar?.o ? Number(bar.open ?? bar.o) : undefined,
        high: bar?.high ?? bar?.h ? Number(bar.high ?? bar.h) : undefined,
        low: bar?.low ?? bar?.l ? Number(bar.low ?? bar.l) : undefined,
        close: price,
        volume,
        timestamp,
        currency: 'USD',
        bid,
        ask,
      }
    } catch (err: any) {
      log.error(`Failed to fetch quote for ${symbol}: ${err?.message || err}`)
      throw err
    }
  }

  public override async getHistoricalCandles(
    symbol: string,
    timeframe: string,
    count: number
  ): Promise<Candle[]> {
    try {
      const alpacaTimeframe = this.mapTimeframe(timeframe)
      const res = await this.client.marketData.stocks.stockBars({
        symbols: [symbol.toUpperCase()],
        timeframe: alpacaTimeframe,
        limit: Math.min(count, 1000),
      })

      const rawBars = res?.bars?.[symbol.toUpperCase()] ?? res?.[symbol.toUpperCase()] ?? []

      return rawBars.map((b: any) => ({
        open: Number(b.open ?? b.o),
        high: Number(b.high ?? b.h),
        low: Number(b.low ?? b.l),
        close: Number(b.close ?? b.c),
        volume: Number(b.volume ?? b.v ?? 0),
        time: Math.floor(new Date(b.timestamp ?? b.t).getTime() / 1000),
      }))
    } catch (err: any) {
      log.error(`Failed to fetch historical candles for ${symbol}: ${err?.message || err}`)
      throw err
    }
  }

  public override async placeOrder(order: MarketOrderRequest): Promise<MarketOrderResponse> {
    try {
      const side = order.side.toLowerCase() as 'buy' | 'sell'
      const type = order.orderType.toLowerCase() as 'market' | 'limit'

      const createOrderRequest: any = {
        symbol: order.symbol.toUpperCase(),
        qty: String(order.quantity),
        side,
        type,
        time_in_force: 'day',
      }

      if (type === 'limit' && order.price) {
        createOrderRequest.limit_price = String(order.price)
      }

      // Handle bracket order / stop-loss / target if provided
      if (order.stopLossPrice && order.targetPrice) {
        createOrderRequest.order_class = 'bracket'
        createOrderRequest.stop_loss = {
          stop_price: String(order.stopLossPrice),
        }
        createOrderRequest.take_profit = {
          limit_price: String(order.targetPrice),
        }
      } else if (order.stopLossPrice) {
        createOrderRequest.order_class = 'oto'
        createOrderRequest.stop_loss = {
          stop_price: String(order.stopLossPrice),
        }
      }

      const res = await this.client.trading.orders.postOrder({ createOrderRequest })
      const placed = res?.order ?? res

      return {
        orderId: placed.id,
        symbol: placed.symbol,
        status: this.mapOrderStatus(placed.status),
        averagePrice: placed.filled_avg_price ? Number(placed.filled_avg_price) : undefined,
        filledQuantity: Number(placed.filled_qty ?? 0),
        placedAt: placed.submitted_at ? new Date(placed.submitted_at).getTime() : Date.now(),
        message: placed.status,
      }
    } catch (err: any) {
      log.error(`Failed to place order for ${order.symbol}: ${err?.message || err}`)
      throw err
    }
  }

  public override async cancelOrder(orderId: string): Promise<boolean> {
    try {
      await this.client.trading.orders.deleteOrderByOrderID({ orderId })
      return true
    } catch (err: any) {
      log.warn(`Failed or already cancelled order ${orderId}: ${err?.message || err}`)
      return false
    }
  }

  public override async getPositions(): Promise<MarketPosition[]> {
    try {
      const positions = await this.client.trading.positions.getAllOpenPositions()
      const list = Array.isArray(positions) ? positions : []

      return list.map((p: any) => ({
        symbol: p.symbol,
        assetClass: p.asset_class === 'crypto' ? 'CRYPTO' : 'EQUITY',
        side: Number(p.qty) >= 0 ? 'BUY' : 'SELL',
        quantity: Math.abs(Number(p.qty)),
        entryPrice: Number(p.avg_entry_price),
        currentPrice: Number(p.current_price),
        unrealizedPnL: Number(p.unrealized_pl),
        realizedPnL: Number(p.unrealized_intraday_pl ?? 0),
        openedAt: Date.now(),
      }))
    } catch (err: any) {
      log.error(`Failed to fetch open positions: ${err?.message || err}`)
      return []
    }
  }

  public async getAccountSummary(): Promise<{
    cash: number
    portfolioValue: number
    buyingPower: number
    currency: string
    status: string
  }> {
    try {
      const acc = await this.client.trading.account.getAccount()
      return {
        cash: Number(acc.cash ?? 0),
        portfolioValue: Number(acc.portfolio_value ?? 0),
        buyingPower: Number(acc.buying_power ?? 0),
        currency: acc.currency ?? 'USD',
        status: acc.status ?? 'ACTIVE',
      }
    } catch (err: any) {
      log.error(`Failed to get account summary: ${err?.message || err}`)
      throw err
    }
  }

  private mapTimeframe(tf: string): string {
    const clean = tf.toLowerCase().trim()
    if (clean === '1m') return '1Min'
    if (clean === '5m') return '5Min'
    if (clean === '15m') return '15Min'
    if (clean === '30m') return '30Min'
    if (clean === '1h') return '1Hour'
    if (clean === '1d') return '1Day'
    return '5Min'
  }

  private mapOrderStatus(status: string): 'PENDING' | 'FILLED' | 'REJECTED' | 'CANCELLED' {
    const s = (status || '').toLowerCase()
    if (s === 'filled') return 'FILLED'
    if (s === 'canceled' || s === 'cancelled' || s === 'expired') return 'CANCELLED'
    if (s === 'rejected') return 'REJECTED'
    return 'PENDING'
  }
}

/**
 * Factory that instantiates a user-isolated AlpacaBrokerAdapter loaded directly
 * from encrypted database credentials stored in the user's profile.
 */
export async function createAlpacaAdapterForUser(userId: string): Promise<AlpacaBrokerAdapter | null> {
  const { userRepo } = await import('../../db/repositories/container.js')
  const creds = await userRepo.getAlpacaCredentials(userId)
  if (!creds || !creds.apiKey || !creds.secretKey) {
    return null
  }
  return new AlpacaBrokerAdapter({
    apiKey: creds.apiKey,
    secretKey: creds.secretKey,
    paper: creds.paper,
    marketId: 'US_EQUITIES',
  })
}
