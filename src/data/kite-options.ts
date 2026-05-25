import "dotenv/config"
import { pathToFileURL } from "node:url"
import type { Instrument } from "kiteconnect"
import { analyzeOptions, type KiteOptionQuote, type KiteOptionInstrumentForAnalysis } from "../analysis/kite-options.js"
import kc from "./kite.js"
import { getYesterdayClosingOI } from "./kite-historical.js"

type KiteOptionInstrument = Instrument & {
  instrument_type: "CE" | "PE"
}

export async function getOptionChain(symbol: string = "NIFTY") {
  const instruments = await kc.getInstruments("NFO")

  const symbolOptions = instruments.filter(
    (i): i is KiteOptionInstrument =>
      i.name === symbol &&
      i.segment === "NFO-OPT" &&
      (i.instrument_type === "CE" || i.instrument_type === "PE")
  )

  // 🧠 Get nearest expiry
  const expiries = [...new Set(symbolOptions.map((i) => i.expiry.toISOString().slice(0, 10)))]
  const nearestExpiry = expiries.sort()[0]

  const filtered = symbolOptions.filter(
    (i) => i.expiry.toISOString().slice(0, 10) === nearestExpiry
  )

  // ⚠️ Limit strikes around ATM (important)
  const strikes = filtered
    .map((i) => i.strike)
    .sort((a: number, b: number) => a - b)

  const mid = Math.floor(strikes.length / 2)
  const selectedStrikes = strikes.slice(mid - 10, mid + 10)

  const finalOptions = filtered
    .filter((i) => selectedStrikes.includes(i.strike))
    .map(i => ({
      instrument_type: i.instrument_type,
      strike: i.strike,
      tradingsymbol: i.tradingsymbol,
      instrument_token: i.instrument_token
    } as KiteOptionInstrumentForAnalysis))

  const symbols = finalOptions.map(
    (i) => `NFO:${i.tradingsymbol}`
  )

  const quotes = await kc.getQuote(symbols) as Record<string, KiteOptionQuote>

  return { quotes, finalOptions, nearestExpiry, selectedStrikes: [...new Set(selectedStrikes)] }
}

function isDirectRun() {
  const scriptPath = process.argv[1]

  if (!scriptPath) {
    return false
  }

  return import.meta.url === pathToFileURL(scriptPath).href
}

async function runStandalone() {
  const symbol = "NIFTY"
  const underlyingTicker = symbol === "NIFTY" ? "NSE:NIFTY 50" : symbol === "BANKNIFTY" ? "NSE:NIFTY BANK" : symbol
  
  console.log(`[Test] Fetching ${symbol} chain and underlying price...`)
  const [{ quotes, finalOptions, nearestExpiry }, underlyingQuote] = await Promise.all([
    getOptionChain(symbol),
    kc.getQuote([underlyingTicker])
  ])

  const underlyingPrice = underlyingQuote[underlyingTicker]?.last_price || 0
  const tokens = finalOptions.map(opt => opt.instrument_token).filter((t): t is number => !!t)
  
  console.log(`[Test] Fetching yesterday's closing OI for ${tokens.length} contracts...`)
  const yesterdayOiMap = await getYesterdayClosingOI(tokens)

  const analysis = analyzeOptions(quotes, finalOptions, underlyingPrice, yesterdayOiMap)

  console.log("\n" + "=".repeat(50))
  console.log(`${symbol} Option-Chain Analysis (Standalone Test)`)
  console.log("=".repeat(50))
  console.log(`Underlying Price: ${underlyingPrice.toFixed(2)}`)
  console.log(`Expiry: ${nearestExpiry}`)
  console.log(`ATM Strike: ${analysis.atmStrike}`)
  console.log(`PCR: ${analysis.pcr} (${analysis.sentiment.toUpperCase()})`)
  console.log(`Support: ${analysis.support} | Resistance: ${analysis.resistance}`)
  console.log("-".repeat(50))
  console.table(analysis.rows.map(r => ({
    Strike: r.strike,
    Type: r.type,
    OI: r.oi.toLocaleString(),
    'Y-OI': r.yesterdayOi?.toLocaleString() || 'N/A',
    'COI-Int': r.intervalOi || 0,
    LTP: r.ltp,
    State: r.buildup
  })))
}

if (isDirectRun()) {
  runStandalone().catch(console.error)
}
