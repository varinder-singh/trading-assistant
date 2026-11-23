const YAHOO_MAP: Record<string, string> = {
  NIFTY: '^NSEI',
  BANKNIFTY: '^NSEBANK',
  FINNIFTY: '^CNXFIN',
  MIDCPNIFTY: '^NSEMDCP50',
}

const KITE_UNDERLYING_MAP: Record<string, string> = {
  NIFTY: 'NSE:NIFTY 50',
  BANKNIFTY: 'NSE:NIFTY BANK',
  FINNIFTY: 'NSE:NIFTY FIN SERVICE',
  MIDCPNIFTY: 'NSE:NIFTY MID SELECT',
}

const KITE_INSTRUMENT_MAP: Record<string, string> = {
  NIFTY: 'NIFTY 50',
  BANKNIFTY: 'NIFTY BANK',
  FINNIFTY: 'NIFTY FIN SERVICE',
  MIDCPNIFTY: 'NIFTY MID SELECT',
}

/**
 * Extracts the underlying asset symbol from any NSE trading symbol,
 * option contract (monthly/weekly), future, or index alias.
 *
 * Examples:
 * - CUMMINSIND26NOV4100CE -> CUMMINSIND
 * - RELIANCE24NOV2500PE -> RELIANCE
 * - NIFTY24NOV24500CE -> NIFTY
 * - BANKNIFTY24D0552000PE -> BANKNIFTY
 * - M&M24NOV3000PE -> M&M
 * - CUMMINSIND24NOVFUT -> CUMMINSIND
 * - CUMMINSIND -> CUMMINSIND
 */
export function extractUnderlyingSymbol(symbol: string): string {
  if (!symbol) return ''
  const s = symbol.toUpperCase().trim()

  // 1. Direct index alias mapping
  if (s === 'NIFTY 50' || s === 'NIFTY') return 'NIFTY'
  if (s === 'NIFTY BANK' || s === 'BANKNIFTY') return 'BANKNIFTY'
  if (s === 'NIFTY FIN SERVICE' || s === 'FINNIFTY') return 'FINNIFTY'
  if (s === 'NIFTY MID SELECT' || s === 'MIDCPNIFTY') return 'MIDCPNIFTY'

  // 2. Options format: <UNDERLYING><YY><EXPIRY><STRIKE><CE|PE>
  // e.g. CUMMINSIND26NOV4100CE, NIFTY24NOV24500PE, NIFTY24N2124500CE, M&M24NOV3000PE
  const optionMatch = s.match(
    /^([A-Z0-9&_-]+?)(?:\d{2}(?:[A-Z]{3}|\d[0-9A-Z]|[OND]\d{2})\d+(?:\.\d+)?)(?:CE|PE)$/
  )
  if (optionMatch && optionMatch[1]) {
    return optionMatch[1]
  }

  // 3. Futures format: <UNDERLYING><YY><EXPIRY>FUT
  // e.g. CUMMINSIND24NOVFUT, NIFTY24NOVFUT
  const futMatch = s.match(
    /^([A-Z0-9&_-]+?)(?:\d{2}(?:[A-Z]{3}|\d[0-9A-Z]|[OND]\d{2}))FUT$/
  )
  if (futMatch && futMatch[1]) {
    return futMatch[1]
  }

  // 4. Fallback for prefix matching on known index families
  if (s.startsWith('NIFTY') && !s.includes('IT')) return 'NIFTY'
  if (s.startsWith('BANKNIFTY')) return 'BANKNIFTY'
  if (s.startsWith('FINNIFTY')) return 'FINNIFTY'
  if (s.startsWith('MIDCPNIFTY')) return 'MIDCPNIFTY'

  return s
}

export function resolveYahooTicker(symbol: string): string {
  const underlying = extractUnderlyingSymbol(symbol)
  const s = underlying.toUpperCase()
  return YAHOO_MAP[s] ?? `${s}.NS`
}

export function resolveKiteUnderlying(symbol: string): string {
  const underlying = extractUnderlyingSymbol(symbol)
  const s = underlying.toUpperCase()
  return KITE_UNDERLYING_MAP[s] ?? `NSE:${s}`
}

export function resolveKiteInstrumentName(symbol: string): string {
  const underlying = extractUnderlyingSymbol(symbol)
  const s = underlying.toUpperCase()
  return KITE_INSTRUMENT_MAP[s] ?? s
}
