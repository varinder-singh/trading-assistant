import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AlpacaBrokerAdapter } from '../src/markets/adapters/alpaca.js'
import { BrokerGatewayRegistry } from '../src/markets/broker-gateway.js'

describe('Alpaca Markets Broker Adapter (US Equities & Crypto)', () => {
  let mockClient: any
  let adapter: AlpacaBrokerAdapter

  beforeEach(() => {
    mockClient = {
      marketData: {
        stocks: {
          stockLatestBarSingle: vi.fn().mockResolvedValue({
            bar: {
              close: 188.5,
              open: 187.0,
              high: 189.2,
              low: 186.8,
              volume: 45000000,
              timestamp: '2026-11-20T20:00:00Z',
            },
          }),
          stockLatestQuoteSingle: vi.fn().mockResolvedValue({
            quote: {
              bid_price: 188.45,
              ask_price: 188.55,
            },
          }),
          stockBars: vi.fn().mockResolvedValue({
            bars: {
              AAPL: [
                {
                  open: 185.0,
                  high: 186.0,
                  low: 184.5,
                  close: 185.8,
                  volume: 12000,
                  timestamp: '2026-11-20T19:45:00Z',
                },
                {
                  open: 185.8,
                  high: 187.5,
                  low: 185.5,
                  close: 187.2,
                  volume: 15000,
                  timestamp: '2026-11-20T19:50:00Z',
                },
              ],
            },
          }),
        },
      },
      trading: {
        orders: {
          postOrder: vi.fn().mockResolvedValue({
            order: {
              id: 'alpaca-ord-12345',
              symbol: 'AAPL',
              status: 'filled',
              filled_avg_price: '188.50',
              filled_qty: '50',
              submitted_at: '2026-11-20T20:01:00Z',
            },
          }),
          deleteOrderByOrderID: vi.fn().mockResolvedValue({}),
        },
        positions: {
          getAllOpenPositions: vi.fn().mockResolvedValue([
            {
              symbol: 'AAPL',
              asset_class: 'us_equity',
              qty: '50',
              avg_entry_price: '185.00',
              current_price: '188.50',
              unrealized_pl: '175.00',
              unrealized_intraday_pl: '50.00',
            },
            {
              symbol: 'BTC/USD',
              asset_class: 'crypto',
              qty: '0.25',
              avg_entry_price: '92000.00',
              current_price: '94500.00',
              unrealized_pl: '625.00',
              unrealized_intraday_pl: '100.00',
            },
          ]),
        },
        account: {
          getAccount: vi.fn().mockResolvedValue({
            cash: '25400.50',
            portfolio_value: '35800.75',
            buying_power: '50801.00',
            currency: 'USD',
            status: 'ACTIVE',
          }),
        },
      },
    }

    adapter = new AlpacaBrokerAdapter({
      apiKey: 'test-key',
      secretKey: 'test-secret',
      paper: true,
      marketId: 'US_EQUITIES',
      alpacaClient: mockClient,
    })
  })

  it('initializes in paper trading mode with default US_EQUITIES market', () => {
    expect(adapter.brokerId).toBe('ALPACA')
    expect(adapter.marketId).toBe('US_EQUITIES')
    expect(adapter.isPaper).toBe(true)
    expect(adapter.brokerName).toBe('AlpacaBrokerAdapter')
  })

  it('fetches real-time quote for US equities (AAPL)', async () => {
    const quote = await adapter.getQuote('AAPL')
    expect(quote.symbol).toBe('AAPL')
    expect(quote.price).toBe(188.5)
    expect(quote.bid).toBe(188.45)
    expect(quote.ask).toBe(188.55)
    expect(quote.currency).toBe('USD')
    expect(quote.volume).toBe(45000000)
    expect(quote.timestamp).toBe(new Date('2026-11-20T20:00:00Z').getTime())
  })

  it('fetches and normalizes historical candles with timeframe mapping', async () => {
    const candles = await adapter.getHistoricalCandles('AAPL', '5m', 2)
    expect(candles).toHaveLength(2)
    expect(candles[0]?.open).toBe(185.0)
    expect(candles[0]?.close).toBe(185.8)
    expect(candles[1]?.high).toBe(187.5)

    expect(mockClient.marketData.stocks.stockBars).toHaveBeenCalledWith({
      symbols: ['AAPL'],
      timeframe: '5Min',
      limit: 2,
    })
  })

  it('places a standard market order', async () => {
    const result = await adapter.placeOrder({
      symbol: 'AAPL',
      assetClass: 'EQUITY',
      side: 'BUY',
      quantity: 50,
      orderType: 'MARKET',
    })

    expect(result.orderId).toBe('alpaca-ord-12345')
    expect(result.symbol).toBe('AAPL')
    expect(result.status).toBe('FILLED')
    expect(result.averagePrice).toBe(188.5)
    expect(result.filledQuantity).toBe(50)

    expect(mockClient.trading.orders.postOrder).toHaveBeenCalledWith({
      createOrderRequest: {
        symbol: 'AAPL',
        qty: '50',
        side: 'buy',
        type: 'market',
        time_in_force: 'day',
      },
    })
  })

  it('places a limit bracket order with stop-loss and take-profit targets', async () => {
    await adapter.placeOrder({
      symbol: 'AAPL',
      assetClass: 'EQUITY',
      side: 'BUY',
      quantity: 25,
      orderType: 'LIMIT',
      price: 188.0,
      stopLossPrice: 186.5,
      targetPrice: 191.0,
    })

    expect(mockClient.trading.orders.postOrder).toHaveBeenCalledWith({
      createOrderRequest: {
        symbol: 'AAPL',
        qty: '25',
        side: 'buy',
        type: 'limit',
        limit_price: '188',
        time_in_force: 'day',
        order_class: 'bracket',
        stop_loss: { stop_price: '186.5' },
        take_profit: { limit_price: '191' },
      },
    })
  })

  it('cancels open orders via deleteOrderByOrderID', async () => {
    const success = await adapter.cancelOrder('alpaca-ord-12345')
    expect(success).toBe(true)
    expect(mockClient.trading.orders.deleteOrderByOrderID).toHaveBeenCalledWith({
      orderId: 'alpaca-ord-12345',
    })
  })

  it('fetches open positions and correctly differentiates equity and crypto', async () => {
    const positions = await adapter.getPositions()
    expect(positions).toHaveLength(2)

    // Position 1: AAPL US Equity
    expect(positions[0]?.symbol).toBe('AAPL')
    expect(positions[0]?.assetClass).toBe('EQUITY')
    expect(positions[0]?.side).toBe('BUY')
    expect(positions[0]?.quantity).toBe(50)
    expect(positions[0]?.unrealizedPnL).toBe(175.0)

    // Position 2: BTC/USD Crypto
    expect(positions[1]?.symbol).toBe('BTC/USD')
    expect(positions[1]?.assetClass).toBe('CRYPTO')
    expect(positions[1]?.quantity).toBe(0.25)
    expect(positions[1]?.unrealizedPnL).toBe(625.0)
  })

  it('queries account cash, portfolio value, and buying power', async () => {
    const account = await adapter.getAccountSummary()
    expect(account.cash).toBe(25400.5)
    expect(account.portfolioValue).toBe(35800.75)
    expect(account.buyingPower).toBe(50801.0)
    expect(account.currency).toBe('USD')
    expect(account.status).toBe('ACTIVE')
  })

  it('registers in BrokerGatewayRegistry and is resolved for US_EQUITIES', () => {
    BrokerGatewayRegistry.register(adapter)
    const resolved = BrokerGatewayRegistry.getForMarket('US_EQUITIES')
    expect(resolved).toBeDefined()
    expect(resolved?.brokerId).toBe('ALPACA')
    expect(resolved?.brokerName).toBe('AlpacaBrokerAdapter')
  })
})
