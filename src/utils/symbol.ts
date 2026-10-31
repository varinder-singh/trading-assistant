const YAHOO_MAP: Record<string, string> = {
  NIFTY: '^NSEI',
  BANKNIFTY: '^NSEBANK',
  FINNIFTY: '^CNXFIN',
}

const KITE_UNDERLYING_MAP: Record<string, string> = {
  NIFTY: 'NSE:NIFTY 50',
  BANKNIFTY: 'NSE:NIFTY BANK',
  FINNIFTY: 'NSE:NIFTY FIN SERVICE',
}

const KITE_INSTRUMENT_MAP: Record<string, string> = {
  NIFTY: 'NIFTY 50',
  BANKNIFTY: 'NIFTY BANK',
  FINNIFTY: 'NIFTY FIN SERVICE',
}

export function resolveYahooTicker(symbol: string): string {
  const s = symbol.toUpperCase()
  return YAHOO_MAP[s] ?? `${s}.NS`
}

export function resolveKiteUnderlying(symbol: string): string {
  const s = symbol.toUpperCase()
  return KITE_UNDERLYING_MAP[s] ?? `NSE:${s}`
}

export function resolveKiteInstrumentName(symbol: string): string {
  const s = symbol.toUpperCase()
  return KITE_INSTRUMENT_MAP[s] ?? s
}
