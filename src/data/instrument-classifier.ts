import type { Connect as KiteConnectInstance, Instrument } from 'kiteconnect'
import { resolveKiteInstrumentName } from '../utils/symbol.js'

export type AssetClass = 'INDEX' | 'EQUITY'

export interface InstrumentClassification {
  symbol: string
  assetClass: AssetClass
  isFnoListed: boolean
  lotSize: number
  segment: 'NSE' | 'NFO'
  token?: number | undefined
}

const INDEX_SYMBOLS = new Set(['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY', 'NIFTY 50', 'NIFTY BANK'])
const CACHE_TTL_MS = 12 * 60 * 60 * 1000 // 12 hours (refreshed daily)

export function isIndexSymbol(symbol: string): boolean {
  if (!symbol) return false
  const upper = symbol.toUpperCase().trim()
  return INDEX_SYMBOLS.has(upper) || upper.startsWith('NIFTY') || upper.startsWith('BANKNIFTY')
}

export function isNearMonthlyExpiry(expiry: Date | string, thresholdDays = 4): boolean {
  const expDate = typeof expiry === 'string' ? new Date(expiry) : expiry
  const diffDays = (expDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
  return diffDays >= 0 && diffDays <= thresholdDays
}

export class InstrumentClassifier {
  private nseCache: Instrument[] | null = null
  private nfoCache: Instrument[] | null = null
  private cacheExpiry: number = 0

  public async getCachedInstruments(
    kc: KiteConnectInstance,
    segment: 'NSE' | 'NFO'
  ): Promise<Instrument[]> {
    const cached = this.getValidCache(segment)
    if (cached) return cached

    return this.refreshCache(kc, segment)
  }

  public async isFnoListed(kc: KiteConnectInstance, symbol: string): Promise<boolean> {
    const s = symbol.toUpperCase().trim()
    if (isIndexSymbol(s)) return true

    try {
      const nfo = await this.getCachedInstruments(kc, 'NFO')
      return nfo.some((i) => i.name === s && i.segment === 'NFO-OPT')
    } catch {
      return false
    }
  }

  public async getFnoLotSize(kc: KiteConnectInstance, symbol: string): Promise<number> {
    const s = symbol.toUpperCase().trim()
    try {
      const nfo = await this.getCachedInstruments(kc, 'NFO')
      const item = nfo.find((i) => i.name === s && i.segment === 'NFO-OPT')
      return item?.lot_size ?? 1
    } catch {
      return 1
    }
  }

  public async classify(
    kc: KiteConnectInstance,
    symbol: string
  ): Promise<InstrumentClassification> {
    const s = symbol.toUpperCase().trim()
    if (isIndexSymbol(s)) {
      return this.buildIndexClassification(s)
    }

    return this.buildEquityClassification(kc, s)
  }

  public clearCache(): void {
    this.nseCache = null
    this.nfoCache = null
    this.cacheExpiry = 0
  }

  private getValidCache(segment: 'NSE' | 'NFO'): Instrument[] | null {
    const isCacheValid = Date.now() < this.cacheExpiry
    if (!isCacheValid) return null
    return segment === 'NSE' ? this.nseCache : this.nfoCache
  }

  private async refreshCache(kc: KiteConnectInstance, segment: 'NSE' | 'NFO'): Promise<Instrument[]> {
    try {
      const list = await kc.getInstruments(segment)
      if (segment === 'NSE') {
        this.nseCache = list
      } else {
        this.nfoCache = list
      }
      this.cacheExpiry = Date.now() + CACHE_TTL_MS
      return list
    } catch (err) {
      console.warn(`[InstrumentClassifier] Fetch failed for ${segment}, checking fallback cache:`, err)
      const fallback = segment === 'NSE' ? this.nseCache : this.nfoCache
      if (fallback) return fallback
      throw err
    }
  }

  private buildIndexClassification(symbol: string): InstrumentClassification {
    const lotSize = symbol.includes('BANK') ? 30 : symbol.includes('FIN') ? 40 : 65
    return {
      symbol,
      assetClass: 'INDEX',
      isFnoListed: true,
      lotSize,
      segment: 'NFO',
    }
  }

  private async buildEquityClassification(
    kc: KiteConnectInstance,
    symbol: string
  ): Promise<InstrumentClassification> {
    const fnoListed = await this.isFnoListed(kc, symbol)
    const nse = await this.getCachedInstruments(kc, 'NSE')
    const targetName = resolveKiteInstrumentName(symbol)
    const nseItem = nse.find((i) => i.tradingsymbol === targetName || i.name === targetName)

    return {
      symbol,
      assetClass: 'EQUITY',
      isFnoListed: fnoListed,
      lotSize: 1,
      segment: 'NSE',
      token: nseItem?.instrument_token ? Number(nseItem.instrument_token) : undefined,
    }
  }
}

export const defaultInstrumentClassifier = new InstrumentClassifier()

// Backward-compatible delegates
export const getCachedInstruments = (kc: KiteConnectInstance, segment: 'NSE' | 'NFO') =>
  defaultInstrumentClassifier.getCachedInstruments(kc, segment)

export const isFnoListed = (kc: KiteConnectInstance, symbol: string) =>
  defaultInstrumentClassifier.isFnoListed(kc, symbol)

export const getFnoLotSize = (kc: KiteConnectInstance, symbol: string) =>
  defaultInstrumentClassifier.getFnoLotSize(kc, symbol)

export const classifyInstrument = (kc: KiteConnectInstance, symbol: string) =>
  defaultInstrumentClassifier.classify(kc, symbol)

export const clearInstrumentCache = () => defaultInstrumentClassifier.clearCache()
