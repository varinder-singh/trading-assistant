import { MarketSession } from './session.js'
import type { IMarketSession, MarketId, MarketScheduleConfig, SpecialSessionConfig } from './types.js'

// Known NSE special sessions (e.g. Diwali Muhurat Trading)
export const NSE_SPECIAL_SESSIONS: SpecialSessionConfig[] = [
  {
    date: '2026-11-08',
    openTime: '14:20',
    closeTime: '18:00',
    name: 'Diwali Muhurat Trading',
  },
]

function getCustomSpecialSessions(): SpecialSessionConfig[] {
  if (typeof process === 'undefined' || !process.env?.SPECIAL_TRADING_SESSIONS) return []
  try {
    return JSON.parse(process.env.SPECIAL_TRADING_SESSIONS)
  } catch {
    return []
  }
}

export const NSE_CONFIG: MarketScheduleConfig = {
  id: 'NSE',
  name: 'National Stock Exchange of India',
  country: 'IN',
  timezone: 'Asia/Kolkata',
  openTime: '09:15',
  closeTime: '15:30',
  is24x7: false,
  tradingDays: [1, 2, 3, 4, 5],
  currency: 'INR',
  defaultContractMultiplier: 1,
  squareOffMinutesBeforeClose: 15, // 15:15 IST mandatory square-off
  openingBellFilterMinutes: 15,
  closingBellFilterMinutes: 15,
  volatilityBenchmark: {
    symbol: '^INDIAVIX',
    name: 'India VIX',
    baseline: 15.0,
    elevatedThreshold: 22.0,
    circuitBreakerThreshold: 28.0,
  },
  specialSessions: [...NSE_SPECIAL_SESSIONS, ...getCustomSpecialSessions()],
}

export const US_EQUITIES_CONFIG: MarketScheduleConfig = {
  id: 'US_EQUITIES',
  name: 'US Equities (NYSE / NASDAQ)',
  country: 'US',
  timezone: 'America/New_York',
  openTime: '09:30',
  closeTime: '16:00',
  is24x7: false,
  tradingDays: [1, 2, 3, 4, 5],
  currency: 'USD',
  defaultContractMultiplier: 100, // Standard 100 shares per US option contract
  squareOffMinutesBeforeClose: 15, // 15:45 EST square-off
  openingBellFilterMinutes: 15,
  closingBellFilterMinutes: 15,
  volatilityBenchmark: {
    symbol: '^VIX',
    name: 'CBOE Volatility Index',
    baseline: 16.0,
    elevatedThreshold: 24.0,
    circuitBreakerThreshold: 35.0,
  },
  specialSessions: [],
}

export const DAX_CONFIG: MarketScheduleConfig = {
  id: 'DAX',
  name: 'German DAX (Frankfurt Xetra)',
  country: 'DE',
  timezone: 'Europe/Berlin',
  openTime: '09:00',
  closeTime: '17:30',
  is24x7: false,
  tradingDays: [1, 2, 3, 4, 5],
  currency: 'EUR',
  defaultContractMultiplier: 5,
  squareOffMinutesBeforeClose: 15, // 17:15 CET square-off
  openingBellFilterMinutes: 15,
  closingBellFilterMinutes: 15,
  volatilityBenchmark: {
    symbol: '^V1DAX',
    name: 'DAX Volatility Index',
    baseline: 17.0,
    elevatedThreshold: 24.0,
    circuitBreakerThreshold: 32.0,
  },
  specialSessions: [],
}

export const CRYPTO_PERP_CONFIG: MarketScheduleConfig = {
  id: 'CRYPTO_PERP',
  name: 'Global Crypto Perpetual Swaps',
  country: 'GLOBAL',
  timezone: 'UTC',
  openTime: '00:00',
  closeTime: '24:00',
  is24x7: true,
  tradingDays: [1, 2, 3, 4, 5, 6, 7], // 7 days a week
  currency: 'USDT',
  defaultContractMultiplier: 1,
  squareOffMinutesBeforeClose: 0, // No square-off (24/7 continuous)
  openingBellFilterMinutes: 0,
  closingBellFilterMinutes: 0,
  volatilityBenchmark: {
    symbol: 'DVOL',
    name: 'Deribit Volatility Index',
    baseline: 45.0,
    elevatedThreshold: 70.0,
    circuitBreakerThreshold: 95.0,
  },
  specialSessions: [],
}

export class MarketRegistry {
  private static readonly markets = new Map<MarketId, IMarketSession>()
  private static activeMarketId: MarketId = 'NSE'

  static {
    // Register built-in market definitions
    MarketRegistry.register(new MarketSession(NSE_CONFIG))
    MarketRegistry.register(new MarketSession(US_EQUITIES_CONFIG))
    MarketRegistry.register(new MarketSession(DAX_CONFIG))
    MarketRegistry.register(new MarketSession(CRYPTO_PERP_CONFIG))
  }

  public static register(session: IMarketSession): void {
    this.markets.set(session.id, session)
  }

  public static get(marketId: MarketId): IMarketSession | undefined {
    return this.markets.get(marketId)
  }

  public static listMarkets(): readonly IMarketSession[] {
    return Array.from(this.markets.values())
  }

  public static setActiveMarket(marketId: MarketId): void {
    if (!this.markets.has(marketId)) {
      throw new Error(`Market "${marketId}" is not registered in MarketRegistry.`)
    }
    this.activeMarketId = marketId
  }

  public static getActiveMarket(): IMarketSession {
    const configuredMarket = process.env?.ACTIVE_MARKET as MarketId | undefined
    const idToUse = configuredMarket && this.markets.has(configuredMarket) ? configuredMarket : this.activeMarketId
    return this.markets.get(idToUse) ?? this.markets.get('NSE')!
  }

  public static resetToDefault(): void {
    this.activeMarketId = 'NSE'
  }
}
