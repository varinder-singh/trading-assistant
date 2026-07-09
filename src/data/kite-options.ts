import "dotenv/config"
import { pathToFileURL } from "node:url"
import type { Connect as KiteConnect, Instrument } from "kiteconnect"
import { analyzeOptions, type KiteOptionQuote, type KiteOptionInstrumentForAnalysis } from "../analysis/kite-options.js"
import { getYesterdayClosingOI } from "./kite-historical.js"
import { resolveKiteUnderlying } from "../utils/symbol.js"

type KiteOptionInstrument = Instrument & {
  instrument_type: "CE" | "PE"
}

export async function getOptionChain(kc: KiteConnect, symbol: string = "NIFTY") {
  const underlyingTicker = resolveKiteUnderlying(symbol)

  // Fetch instruments and underlying spot price in parallel
  const [instruments, underlyingQuote] = await Promise.all([
    kc.getInstruments("NFO"),
    kc.getQuote([underlyingTicker]).catch(err => {
      console.warn(`[getOptionChain] Failed to fetch spot quote for ${underlyingTicker}:`, err)
      return {} as Record<string, any>
    })
  ])

  const spotPrice = underlyingQuote[underlyingTicker]?.last_price || 0
  console.log(`[getOptionChain] Resolved spot price for ${symbol} (${underlyingTicker}): ${spotPrice}`)

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
  const strikes = [...new Set(filtered.map((i) => i.strike))]
    .sort((a: number, b: number) => a - b)

  let atmIndex = -1
  if (spotPrice > 0) {
    let minDiff = Infinity
    for (let i = 0; i < strikes.length; i++) {
      const diff = Math.abs(strikes[i]! - spotPrice)
      if (diff < minDiff) {
        minDiff = diff
        atmIndex = i
      }
    }
  }

  const mid = atmIndex >= 0 ? atmIndex : Math.floor(strikes.length / 2)
  const selectedStrikes = strikes.slice(Math.max(0, mid - 10), Math.min(strikes.length, mid + 10))

  const finalOptions = filtered
    .filter((i) => selectedStrikes.includes(i.strike))
    .map(i => ({
      instrument_type: i.instrument_type,
      strike: i.strike,
      tradingsymbol: i.tradingsymbol,
      instrument_token: Number(i.instrument_token),
      expiry: nearestExpiry
    } as KiteOptionInstrumentForAnalysis))

  const symbols = finalOptions.map(
    (i) => `NFO:${i.tradingsymbol}`
  )

  const quotes = await kc.getQuote(symbols) as Record<string, KiteOptionQuote>

  const lotSize = filtered.length > 0 ? (filtered[0]?.lot_size || 0) : 0

  return { quotes, finalOptions, nearestExpiry, selectedStrikes, lotSize }
}

function isDirectRun() {
  const scriptPath = process.argv[1]

  if (!scriptPath) {
    return false
  }

  return import.meta.url === pathToFileURL(scriptPath).href
}

async function runStandalone() {
  const { createKiteClient } = await import("./kite.js")
  const kc = createKiteClient(process.env.KITE_ACCESS_TOKEN)
  const symbol = process.argv[2] || "NIFTY"
  const underlyingTicker = resolveKiteUnderlying(symbol)
  
  console.log(`[Test] Fetching ${symbol} chain and underlying price...`)
  const [{ quotes, finalOptions, nearestExpiry }, underlyingQuote] = await Promise.all([
    getOptionChain(kc, symbol),
    kc.getQuote([underlyingTicker])
  ])

  const underlyingPrice = underlyingQuote[underlyingTicker]?.last_price || 0
  const tokens = finalOptions.map((opt: any) => opt.instrument_token).filter((t: any): t is number => !!t)
  
  console.log(`[Test] Fetching yesterday's closing OI for ${tokens.length} contracts...`)
  const yesterdayOiMap = await getYesterdayClosingOI(kc, tokens)

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
  const { generateOIHeatmap } = await import("../analysis/heatmap.js")
  console.log(generateOIHeatmap(analysis))
}

if (isDirectRun()) {
  runStandalone().catch(console.error)
}
