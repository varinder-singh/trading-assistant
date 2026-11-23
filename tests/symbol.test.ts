import { describe, it, expect } from 'vitest'
import {
  extractUnderlyingSymbol,
  resolveYahooTicker,
  resolveKiteUnderlying,
  resolveKiteInstrumentName,
} from '../src/utils/symbol.js'

describe('Symbol Utilities & Underlying Extraction', () => {
  describe('extractUnderlyingSymbol', () => {
    it('extracts underlying from stock options (monthly contract)', () => {
      expect(extractUnderlyingSymbol('CUMMINSIND26NOV4100CE')).toBe('CUMMINSIND')
      expect(extractUnderlyingSymbol('RELIANCE24NOV2500PE')).toBe('RELIANCE')
      expect(extractUnderlyingSymbol('TCS24DEC3800CE')).toBe('TCS')
      expect(extractUnderlyingSymbol('TATAMOTORS24NOV800PE')).toBe('TATAMOTORS')
      expect(extractUnderlyingSymbol('INFY24NOV1850CE')).toBe('INFY')
    })

    it('extracts underlying from stock options with symbols containing special characters', () => {
      expect(extractUnderlyingSymbol('M&M24NOV3000PE')).toBe('M&M')
      expect(extractUnderlyingSymbol('BAJAJ-AUTO24NOV9500CE')).toBe('BAJAJ-AUTO')
      expect(extractUnderlyingSymbol('L&TFH24NOV180CE')).toBe('L&TFH')
      expect(extractUnderlyingSymbol('MCDOWELL-N24NOV1100PE')).toBe('MCDOWELL-N')
    })

    it('extracts underlying from index options (both monthly and weekly)', () => {
      expect(extractUnderlyingSymbol('NIFTY24NOV24500CE')).toBe('NIFTY')
      expect(extractUnderlyingSymbol('BANKNIFTY24NOV52000PE')).toBe('BANKNIFTY')
      expect(extractUnderlyingSymbol('FINNIFTY24NOV23000CE')).toBe('FINNIFTY')
      expect(extractUnderlyingSymbol('MIDCPNIFTY24NOV12000CE')).toBe('MIDCPNIFTY')

      // Weekly index format (YY + M + DD)
      expect(extractUnderlyingSymbol('NIFTY24N2124500CE')).toBe('NIFTY')
      expect(extractUnderlyingSymbol('BANKNIFTY24D0552000PE')).toBe('BANKNIFTY')
      expect(extractUnderlyingSymbol('FINNIFTY2411823000CE')).toBe('FINNIFTY')
    })

    it('extracts underlying from futures contracts', () => {
      expect(extractUnderlyingSymbol('CUMMINSIND24NOVFUT')).toBe('CUMMINSIND')
      expect(extractUnderlyingSymbol('NIFTY24NOVFUT')).toBe('NIFTY')
      expect(extractUnderlyingSymbol('RELIANCE24DECFUT')).toBe('RELIANCE')
    })

    it('preserves clean equity symbols and index names', () => {
      expect(extractUnderlyingSymbol('CUMMINSIND')).toBe('CUMMINSIND')
      expect(extractUnderlyingSymbol('RELIANCE')).toBe('RELIANCE')
      expect(extractUnderlyingSymbol('NIFTY')).toBe('NIFTY')
      expect(extractUnderlyingSymbol('NIFTY 50')).toBe('NIFTY')
      expect(extractUnderlyingSymbol('BANKNIFTY')).toBe('BANKNIFTY')
      expect(extractUnderlyingSymbol('NIFTY BANK')).toBe('BANKNIFTY')
      expect(extractUnderlyingSymbol('FINNIFTY')).toBe('FINNIFTY')
      expect(extractUnderlyingSymbol('NIFTY FIN SERVICE')).toBe('FINNIFTY')
    })

    it('handles empty or blank inputs gracefully', () => {
      expect(extractUnderlyingSymbol('')).toBe('')
    })
  })

  describe('resolveYahooTicker', () => {
    it('resolves correct Yahoo ticker for stock options by resolving underlying', () => {
      expect(resolveYahooTicker('CUMMINSIND26NOV4100CE')).toBe('CUMMINSIND.NS')
      expect(resolveYahooTicker('RELIANCE24NOV2500PE')).toBe('RELIANCE.NS')
    })

    it('resolves mapped Yahoo index symbols for index options and underlying indices', () => {
      expect(resolveYahooTicker('NIFTY24NOV24500CE')).toBe('^NSEI')
      expect(resolveYahooTicker('NIFTY')).toBe('^NSEI')
      expect(resolveYahooTicker('BANKNIFTY24NOV52000PE')).toBe('^NSEBANK')
      expect(resolveYahooTicker('BANKNIFTY')).toBe('^NSEBANK')
      expect(resolveYahooTicker('FINNIFTY24NOV23000CE')).toBe('^CNXFIN')
      expect(resolveYahooTicker('FINNIFTY')).toBe('^CNXFIN')
    })

    it('resolves standard equity tickers', () => {
      expect(resolveYahooTicker('CUMMINSIND')).toBe('CUMMINSIND.NS')
      expect(resolveYahooTicker('TCS')).toBe('TCS.NS')
    })
  })

  describe('resolveKiteUnderlying & resolveKiteInstrumentName', () => {
    it('resolves correct Kite underlying exchange prefixes', () => {
      expect(resolveKiteUnderlying('CUMMINSIND26NOV4100CE')).toBe('NSE:CUMMINSIND')
      expect(resolveKiteUnderlying('NIFTY24NOV24500CE')).toBe('NSE:NIFTY 50')
      expect(resolveKiteUnderlying('BANKNIFTY24NOV52000PE')).toBe('NSE:NIFTY BANK')
      expect(resolveKiteUnderlying('CUMMINSIND')).toBe('NSE:CUMMINSIND')
    })

    it('resolves correct Kite instrument names for lookup', () => {
      expect(resolveKiteInstrumentName('CUMMINSIND26NOV4100CE')).toBe('CUMMINSIND')
      expect(resolveKiteInstrumentName('NIFTY24NOV24500CE')).toBe('NIFTY 50')
      expect(resolveKiteInstrumentName('CUMMINSIND')).toBe('CUMMINSIND')
    })
  })
})
