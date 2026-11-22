import type {
  IBrokerGateway,
  MarketId,
  MarketOrderRequest,
  MarketOrderResponse,
  MarketPosition,
  MarketQuote,
} from './types.js'
import type { Candle } from '../types/analysis.js'

export abstract class BaseBrokerAdapter implements IBrokerGateway {
  constructor(
    public readonly brokerId: string,
    public readonly marketId: MarketId,
    public readonly brokerName: string = brokerId
  ) {}

  abstract getQuote(symbol: string): Promise<MarketQuote>
  abstract getHistoricalCandles(symbol: string, timeframe: string, count: number): Promise<Candle[]>
  abstract placeOrder(order: MarketOrderRequest): Promise<MarketOrderResponse>
  abstract cancelOrder(orderId: string): Promise<boolean>
  abstract getPositions(): Promise<MarketPosition[]>
}

export class BrokerGatewayRegistry {
  private static readonly adapters = new Map<string, IBrokerGateway>()
  private static activeBrokerId: string = 'KITE'

  public static register(adapter: IBrokerGateway): void {
    const key = `${adapter.marketId}:${adapter.brokerId}`.toUpperCase()
    this.adapters.set(key, adapter)
  }

  public static get(marketId: MarketId, brokerId: string): IBrokerGateway | undefined {
    const key = `${marketId}:${brokerId}`.toUpperCase()
    return this.adapters.get(key)
  }

  public static getForMarket(marketId: MarketId): IBrokerGateway | undefined {
    const prefix = `${marketId}:`.toUpperCase()
    for (const [key, adapter] of this.adapters.entries()) {
      if (key.startsWith(prefix)) {
        return adapter
      }
    }
    return undefined
  }

  public static listAdapters(): readonly IBrokerGateway[] {
    return Array.from(this.adapters.values())
  }

  public static reset(): void {
    this.adapters.clear()
  }
}
