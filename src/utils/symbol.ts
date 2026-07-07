export function resolveYahooTicker(symbol: string): string {
  const s = symbol.toUpperCase()
  if (s === 'NIFTY') return '^NSEI'
  if (s === 'BANKNIFTY') return '^NSEBANK'
  if (s === 'FINNIFTY') return '^CNXFIN'
  // NSE Equities fallback
  return `${s}.NS`
}

export function resolveKiteUnderlying(symbol: string): string {
  const s = symbol.toUpperCase()
  if (s === 'NIFTY') return 'NSE:NIFTY 50'
  if (s === 'BANKNIFTY') return 'NSE:NIFTY BANK'
  if (s === 'FINNIFTY') return 'NSE:NIFTY FIN SERVICE'
  // NSE Equities fallback
  return `NSE:${s}`
}

export function resolveKiteInstrumentName(symbol: string): string {
  const s = symbol.toUpperCase()
  if (s === 'NIFTY') return 'NIFTY 50'
  if (s === 'BANKNIFTY') return 'NIFTY BANK'
  if (s === 'FINNIFTY') return 'NIFTY FIN SERVICE'
  // NSE Equities fallback
  return s
}
