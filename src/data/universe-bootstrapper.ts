import type { Connect as KiteConnectInstance } from 'kiteconnect'
import { InstrumentClassifier } from './instrument-classifier.js'
import { KiteScanner, globalKiteScanner } from './kite-scanner.js'
import { NIFTY_100_SET } from './nifty100-symbols.js'

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

      const registeredTokens = Array.from(fnoUnderlyings)
        .map((symbol) => ({ symbol, token: nseEquityMap.get(symbol) }))
        .filter((entry): entry is { symbol: string; token: number } => entry.token !== undefined)
        .map(({ symbol, token }) => {
          scanner.registerFnoStock(token, symbol)
          return token
        })

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
    const universeMode = (process.env.SCANNER_UNIVERSE_MODE || 'NIFTY_100').toUpperCase().trim()

    const validSymbols = nfoList
      .filter((item) => item?.segment === 'NFO-OPT' && typeof item?.name === 'string')
      .map((item) => item.name.toUpperCase().trim())
      .filter((symbol) => !this.isExcludedIndex(symbol))
      .filter((symbol) => universeMode === 'ALL_FNO' || NIFTY_100_SET.has(symbol))

    return new Set(validSymbols)
  }

  private isExcludedIndex(symbol: string): boolean {
    return (
      symbol.startsWith('NIFTY') ||
      symbol.startsWith('BANKNIFTY') ||
      symbol.startsWith('FINNIFTY') ||
      symbol.startsWith('MIDCPNIFTY')
    )
  }

  private buildNseEquityMap(nseList: any[]): Map<string, number> {
    const entries = nseList
      .filter((item) => item?.segment === 'NSE' && (item.instrument_type === 'EQ' || !item.instrument_type))
      .filter((item) => item?.tradingsymbol && item?.instrument_token)
      .map((item) => [item.tradingsymbol.toUpperCase().trim(), Number(item.instrument_token)] as const)

    return new Map(entries)
  }
}

export const universeBootstrapper = new UniverseBootstrapper()
