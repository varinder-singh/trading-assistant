import type { Connect as KiteConnectInstance } from 'kiteconnect'
import { InstrumentClassifier } from './instrument-classifier.js'
import { KiteScanner, globalKiteScanner } from './kite-scanner.js'

export class UniverseBootstrapper {
  constructor(private readonly classifier: InstrumentClassifier = new InstrumentClassifier()) {}

  public async bootstrapScannerUniverse(
    kc: KiteConnectInstance,
    scanner: KiteScanner = globalKiteScanner
  ): Promise<number[]> {
    const existingTokens = scanner.getTokens()
    if (existingTokens.length > 0) {
      return existingTokens
    }

    try {
      console.log('[UniverseBootstrapper] 🔄 Bootstrapping F&O equity stock universe from Kite...')
      const [nfoList, nseList] = await Promise.all([
        this.classifier.getCachedInstruments(kc, 'NFO'),
        this.classifier.getCachedInstruments(kc, 'NSE'),
      ])

      const fnoUnderlyings = this.extractFnoUnderlyings(nfoList)
      const nseEquityMap = this.buildNseEquityMap(nseList)

      const registeredTokens: number[] = []
      for (const symbol of fnoUnderlyings) {
        const token = nseEquityMap.get(symbol)
        if (token) {
          scanner.registerStock(token, symbol, true)
          registeredTokens.push(token)
        }
      }

      console.log(
        `[UniverseBootstrapper] ✅ Registered ${registeredTokens.length} active F&O equity stocks into KiteScanner.`
      )
      return registeredTokens
    } catch (err: any) {
      console.error('[UniverseBootstrapper] ❌ Failed to bootstrap universe:', err.message || err)
      return []
    }
  }

  private extractFnoUnderlyings(nfoList: any[]): Set<string> {
    const underlyings = new Set<string>()
    for (const item of nfoList) {
      if (item.segment === 'NFO-OPT' && item.name && typeof item.name === 'string') {
        const s = item.name.toUpperCase().trim()
        if (!s.startsWith('NIFTY') && !s.startsWith('BANKNIFTY') && !s.startsWith('FINNIFTY') && !s.startsWith('MIDCPNIFTY')) {
          underlyings.add(s)
        }
      }
    }
    return underlyings
  }

  private buildNseEquityMap(nseList: any[]): Map<string, number> {
    const map = new Map<string, number>()
    for (const item of nseList) {
      if (item.segment === 'NSE' && (item.instrument_type === 'EQ' || !item.instrument_type)) {
        const sym = (item.tradingsymbol || '').toUpperCase().trim()
        if (sym && item.instrument_token) {
          map.set(sym, Number(item.instrument_token))
        }
      }
    }
    return map
  }
}

export const universeBootstrapper = new UniverseBootstrapper()
