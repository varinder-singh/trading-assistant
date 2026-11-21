import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { MarketRegistry } from '../src/markets/registry.js'
import {
  isMarketOpen,
  isOpeningBellFilterActive,
  isClosingBellFilterActive,
  getMarketStatusMessage,
} from '../src/utils/market-hours.js'
import { MASToolRegistry } from '../src/ai/mas/tools.js'
import { BaseBrokerAdapter, BrokerGatewayRegistry } from '../src/markets/broker-gateway.js'
import type { MarketOrderRequest, MarketOrderResponse, MarketQuote } from '../src/markets/types.js'

describe('Universal Multi-Market Infrastructure & Session Registry', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
    MarketRegistry.resetToDefault()
  })

  afterEach(() => {
    process.env = originalEnv
    MarketRegistry.resetToDefault()
  })

  describe('Registry Core & Built-in Markets', () => {
    it('lists all built-in market definitions', () => {
      const markets = MarketRegistry.listMarkets()
      const ids = markets.map((m) => m.id)
      expect(ids).toContain('NSE')
      expect(ids).toContain('US_EQUITIES')
      expect(ids).toContain('DAX')
      expect(ids).toContain('CRYPTO_PERP')
    })

    it('defaults active market to NSE', () => {
      const active = MarketRegistry.getActiveMarket()
      expect(active.id).toBe('NSE')
      expect(active.currency).toBe('INR')
      expect(active.getVolatilityBenchmark().symbol).toBe('^INDIAVIX')
    })

    it('allows setting active market dynamically via registry or environment variable', () => {
      MarketRegistry.setActiveMarket('US_EQUITIES')
      expect(MarketRegistry.getActiveMarket().id).toBe('US_EQUITIES')
      expect(MarketRegistry.getActiveMarket().currency).toBe('USD')

      process.env.ACTIVE_MARKET = 'CRYPTO_PERP'
      expect(MarketRegistry.getActiveMarket().id).toBe('CRYPTO_PERP')
      expect(MarketRegistry.getActiveMarket().is24x7).toBe(true)
    })
  })

  describe('Market Schedules across Global Timezones', () => {
    it('NSE: evaluates Indian Standard Time (IST)', () => {
      const nse = MarketRegistry.get('NSE')!
      // Wednesday 2026-11-04 10:30 IST = 05:00 UTC -> OPEN
      const openTime = new Date('2026-11-04T05:00:00Z')
      expect(nse.isMarketOpen(openTime)).toBe(true)

      // Wednesday 2026-11-04 09:20 IST = 03:50 UTC -> Opening Bell filter active
      const openingTime = new Date('2026-11-04T03:50:00Z')
      expect(nse.isOpeningBellFilterActive(openingTime)).toBe(true)

      // Wednesday 2026-11-04 15:20 IST = 09:50 UTC -> Closing Bell filter active
      const closingTime = new Date('2026-11-04T09:50:00Z')
      expect(nse.isClosingBellFilterActive(closingTime)).toBe(true)

      // Remaining runway at 14:45 IST (09:15 UTC): 30 minutes before 15:15 square-off
      const runwayTime = new Date('2026-11-04T09:15:00Z')
      expect(nse.getTimeToCloseMinutes(runwayTime)).toBe(30)
    })

    it('US_EQUITIES: evaluates Eastern Standard Time (EST / New York)', () => {
      const us = MarketRegistry.get('US_EQUITIES')!
      // US Equities hours: 09:30 - 16:00 EST (America/New_York)
      // Wednesday 2026-11-04 at 10:00 AM EST (15:00 UTC) -> OPEN
      const openTime = new Date('2026-11-04T15:00:00Z')
      expect(us.isMarketOpen(openTime)).toBe(true)

      // Wednesday 2026-11-04 at 09:35 AM EST (14:35 UTC) -> Opening Bell active (first 15m)
      const openingTime = new Date('2026-11-04T14:35:00Z')
      expect(us.isOpeningBellFilterActive(openingTime)).toBe(true)

      // Wednesday 2026-11-04 at 15:50 EST (20:50 UTC) -> Closing Bell active (last 15m before 16:00)
      const closingTime = new Date('2026-11-04T20:50:00Z')
      expect(us.isClosingBellFilterActive(closingTime)).toBe(true)

      // Wednesday 2026-11-04 at 08:30 AM EST (13:30 UTC) -> Pre-market CLOSED
      const preMarket = new Date('2026-11-04T13:30:00Z')
      expect(us.isMarketOpen(preMarket)).toBe(false)

      // Square-off is at 15:45 EST (15m before 16:00 close). At 15:15 EST, runway is 30m.
      const runwayTime = new Date('2026-11-04T20:15:00Z') // 15:15 EST
      expect(us.getTimeToCloseMinutes(runwayTime)).toBe(30)
    })

    it('DAX: evaluates Frankfurt Xetra Central European Time (CET)', () => {
      const dax = MarketRegistry.get('DAX')!
      // DAX hours: 09:00 - 17:30 CET (Europe/Berlin, UTC+1 in winter)
      // Wednesday 2026-11-04 at 10:00 CET (09:00 UTC) -> OPEN
      const openTime = new Date('2026-11-04T09:00:00Z')
      expect(dax.isMarketOpen(openTime)).toBe(true)

      // Wednesday 2026-11-04 at 17:20 CET (16:20 UTC) -> Closing Bell active (last 15m)
      const closingTime = new Date('2026-11-04T16:20:00Z')
      expect(dax.isClosingBellFilterActive(closingTime)).toBe(true)

      // Volatility benchmark: ^V1DAX
      expect(dax.getVolatilityBenchmark().symbol).toBe('^V1DAX')
    })

    it('CRYPTO_PERP: operates 24/7 continuous trading without runway traps', () => {
      const crypto = MarketRegistry.get('CRYPTO_PERP')!
      // Sunday midnight UTC
      const sundayMidnight = new Date('2026-11-01T00:00:00Z')
      expect(crypto.isMarketOpen(sundayMidnight)).toBe(true)
      expect(crypto.isOpeningBellFilterActive(sundayMidnight)).toBe(false)
      expect(crypto.isClosingBellFilterActive(sundayMidnight)).toBe(false)
      expect(crypto.getTimeToCloseMinutes(sundayMidnight)).toBe(Number.POSITIVE_INFINITY)
      expect(crypto.isRunwayConstrained(60, sundayMidnight)).toBe(false)
    })
  })

  describe('Integration with market-hours.ts and inspectSessionHorizon', () => {
    it('seamlessly updates market-hours functions when ACTIVE_MARKET changes', () => {
      process.env.ACTIVE_MARKET = 'US_EQUITIES'

      // At 15:00 UTC (10:00 AM EST), US is OPEN while NSE (20:30 IST) is CLOSED
      const time = new Date('2026-11-04T15:00:00Z')
      expect(isMarketOpen(time)).toBe(true)
      expect(getMarketStatusMessage(time)).toContain('US Equities')
    })

    it('inspectSessionHorizon adapts when running under CRYPTO_PERP market', () => {
      process.env.ACTIVE_MARKET = 'CRYPTO_PERP'

      const mockBlackboard: any = {
        structureSlice: { istTime: '23:45:00' },
        policy: { minTrapReversalScore: 3 },
      }
      const tools = MASToolRegistry.buildStructureTools(mockBlackboard)
      const horizonTool = tools.find((t) => t.name === 'inspectSessionHorizon')!
      const result: any = horizonTool.execute({})

      expect(result.is24x7).toBe(true)
      expect(result.timeToSquareOffMins).toBe(Number.POSITIVE_INFINITY)
      expect(result.isClosingRunwayRisk).toBe(false)
      expect(result.recommendation).toBe('ALLOW_ALL')
    })
  })

  describe('Broker Gateway & Multi-Broker Routing', () => {
    class MockUSBroker extends BaseBrokerAdapter {
      public override async getQuote(symbol: string): Promise<MarketQuote> {
        return {
          symbol,
          price: 185.5,
          currency: 'USD',
          timestamp: Date.now(),
          bid: 185.45,
          ask: 185.55,
          volume: 12000000,
        }
      }

      public override async getHistoricalCandles(): Promise<any[]> {
        return []
      }

      public override async cancelOrder(): Promise<boolean> {
        return true
      }

      public override async getPositions(): Promise<any[]> {
        return []
      }

      public override async placeOrder(order: MarketOrderRequest): Promise<MarketOrderResponse> {
        return {
          orderId: 'MOCK-US-' + Date.now(),
          symbol: order.symbol,
          status: 'FILLED',
          averagePrice: 185.5,
          filledQuantity: order.quantity,
          placedAt: Date.now(),
        }
      }
    }

    it('registers and retrieves broker adapters by market ID', async () => {
      const broker = new MockUSBroker('IBKR', 'US_EQUITIES', 'InteractiveBrokersAdapter')
      BrokerGatewayRegistry.register(broker)

      const retrieved = BrokerGatewayRegistry.getForMarket('US_EQUITIES')
      expect(retrieved).toBeDefined()
      expect(retrieved?.brokerName).toBe('InteractiveBrokersAdapter')

      const quote = await retrieved?.getQuote('AAPL')
      expect(quote?.price).toBe(185.5)

      const orderResult = await retrieved?.placeOrder({
        symbol: 'AAPL',
        assetClass: 'EQUITY',
        side: 'BUY',
        quantity: 50,
        orderType: 'MARKET',
      })
      expect(orderResult?.status).toBe('FILLED')
      expect(orderResult?.filledQuantity).toBe(50)
    })
  })
})
