import axios from "axios"
import type { Connect as KiteConnectInstance } from "kiteconnect"
import type { Candle } from "../types/analysis.js"
import { getInstrumentToken } from "./kite.js"
import { resolveYahooTicker } from "../utils/symbol.js"

type KiteHistoricalInterval = Parameters<KiteConnectInstance['getHistoricalData']>[1]

const KITE_INTERVAL_MAP: Record<string, KiteHistoricalInterval> = {
  '1h': '60minute',
  '1d': 'day',
  '5m': '5minute',
  '15m': '15minute',
  '30m': '30minute',
}

function formatToIST(date: Date): string {
  return new Intl.DateTimeFormat('en-ZA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
    .format(date)
    .replace(/\//g, '-')
    .replace(',', '')
}

export async function getKiteCandles(
  kc: KiteConnectInstance,
  token: number,
  interval: string,
  days: number
): Promise<Candle[]> {
  const now = new Date()
  const from = new Date(now)
  from.setDate(from.getDate() - days)

  const fromStr = formatToIST(from)
  const toStr = formatToIST(now)
  const kiteInterval = KITE_INTERVAL_MAP[interval] ?? (interval as KiteHistoricalInterval)

  const data = await kc.getHistoricalData(token.toString(), kiteInterval, fromStr, toStr)
  return data.map((d: any) => ({
    time: new Date(d.date).getTime() / 1000,
    open: d.open,
    high: d.high,
    low: d.low,
    close: d.close,
    volume: d.volume,
  }))
}

export async function getKiteMultiTimeframeCandles(kc: KiteConnectInstance, symbol: string) {
  const token = await getInstrumentToken(kc, symbol)
  if (!token) {
    throw new Error(`Kite token not found for symbol: ${symbol}`)
  }

  const [candles1d, candles1h, candles30m, candles15m, candles5m] = await Promise.all([
    getKiteCandles(kc, token, '1d', 60),
    getKiteCandles(kc, token, '1h', 30),
    getKiteCandles(kc, token, '30m', 5),
    getKiteCandles(kc, token, '15m', 5),
    getKiteCandles(kc, token, '5m', 5),
  ])

  return { candles1d, candles1h, candles30m, candles15m, candles5m }
}

export async function getCandles(symbol: string, interval: string = '15m', range: string = '5d'): Promise<Candle[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=${interval}&range=${range}`

  const res = await axios.get(url)
  const result = res.data.chart.result[0]

  const { open, high, low, close, volume } = result.indicators.quote[0]
  const timestamps = result.timestamp

  return timestamps
    .map((t: number, i: number) => ({
      time: t,
      open: open[i],
      high: high[i],
      low: low[i],
      close: close[i],
      volume: volume[i],
    }))
    .filter((c: any) => c.open !== null && c.high !== null && c.low !== null && c.close !== null) as Candle[]
}

export async function getMultiTimeframeCandles(symbol: string, kc?: KiteConnectInstance) {
  if (kc) {
    try {
      console.log(`[Candles] Fetching primary candles from Zerodha/Kite for ${symbol}...`)
      return await getKiteMultiTimeframeCandles(kc, symbol)
    } catch (err) {
      console.warn(`[Candles] Zerodha/Kite candles fetch failed, falling back to Yahoo for ${symbol}:`, err)
    }
  }

  const yahooTicker = resolveYahooTicker(symbol)
  console.log(`[Candles] Fetching fallback candles from Yahoo Finance for ${yahooTicker}...`)

  const [candles1d, candles1h, candles30m, candles15m, candles5m] = await Promise.all([
    getCandles(yahooTicker, '1d', '60d'),
    getCandles(yahooTicker, '1h', '1mo'),
    getCandles(yahooTicker, '30m', '5d'),
    getCandles(yahooTicker, '15m', '5d'),
    getCandles(yahooTicker, '5m', '5d').catch(() => []),
  ])

  return {
    candles1d,
    candles1h,
    candles30m,
    candles15m,
    candles5m: candles5m && candles5m.length > 0 ? candles5m : candles15m,
  }
}

