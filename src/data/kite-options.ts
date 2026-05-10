import { pathToFileURL } from "node:url"
import type { Instrument } from "kiteconnect"
import { analyzeOptions, type KiteOptionQuote } from "../analysis/kite-options.js"
import kc from "./kite.js"

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

  const finalOptions = filtered.filter((i) =>
    selectedStrikes.includes(i.strike)
  )

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
  const { quotes, finalOptions, nearestExpiry, selectedStrikes } = await getOptionChain("NIFTY")
  const analysis = analyzeOptions(quotes, finalOptions)

  console.log("NIFTY option-chain PCR input from Kite")
  console.log(`Expiry: ${nearestExpiry}`)
  console.log(`Selected strikes: ${selectedStrikes.join(", ")}`)
  console.log(`Options fetched: ${finalOptions.length}`)
  console.log(`Call OI: ${analysis.callOI}`)
  console.log(`Put OI: ${analysis.putOI}`)
  console.log(`PCR: ${analysis.pcr} (${analysis.sentiment})`)
  console.log(`OI Support: ${analysis.support} (max PE OI: ${analysis.maxPutOI})`)
  console.log(`OI Resistance: ${analysis.resistance} (max CE OI: ${analysis.maxCallOI})`)
  console.table(analysis.rows)
}

if (isDirectRun()) {
  await runStandalone()
}
