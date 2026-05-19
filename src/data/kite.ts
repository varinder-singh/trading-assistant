import "dotenv/config"
import { KiteConnect } from "kiteconnect"
import { existsSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join, resolve } from "node:path"

type CachedKiteToken = {
  accessToken?: string
}

function readCachedAccessToken() {
  const pathsToTry = [
    resolve(process.cwd(), ".kite", "access-token.json"), // CLI
    resolve(process.cwd(), "..", ".kite", "access-token.json"), // Nuxt dev
    join(dirname(fileURLToPath(import.meta.url)), "../../.kite", "access-token.json") // Fallback
  ]

  let foundPath: string | undefined = undefined

  for (const p of pathsToTry) {
    if (existsSync(p)) {
      foundPath = p
      break
    }
  }

  if (!foundPath) {
    console.error(`[Kite] Could not find access-token.json. Tried: \n${pathsToTry.join("\n")}`)
    return undefined
  }

  console.log(`[Kite] Found token at: ${foundPath}`)
  const cachedToken = JSON.parse(readFileSync(foundPath, "utf8")) as CachedKiteToken
  return cachedToken.accessToken
}

export function getAccessToken() {
  const accessToken = readCachedAccessToken() ?? process.env.KITE_ACCESS_TOKEN

  if (!accessToken) {
    throw new Error("KITE_ACCESS_TOKEN is missing. Run `npm run kite:token` to generate a fresh token.")
  }

  return accessToken
}

const apiKey = process.env.KITE_API_KEY
if (!apiKey) {
  throw new Error("KITE_API_KEY is missing in environment variables. Check your .env file.")
}

const kc = new KiteConnect({
  api_key: apiKey,
})

kc.setAccessToken(getAccessToken())

export async function getInstrumentToken(symbol: string): Promise<number | undefined> {
  const instruments = await kc.getInstruments("NSE")
  // NIFTY -> NIFTY 50, BANKNIFTY -> NIFTY BANK
  const nameMap: Record<string, string> = {
    "NIFTY": "NIFTY 50",
    "BANKNIFTY": "NIFTY BANK",
    "FINNIFTY": "NIFTY FIN SERVICE"
  }
  const targetName = nameMap[symbol] ?? symbol
  const instrument = instruments.find(i => i.tradingsymbol === targetName || i.name === targetName)
  return instrument?.instrument_token ? Number(instrument.instrument_token) : undefined
}

export async function getOptionToken(underlying: string, strike: number, type: "CE" | "PE"): Promise<{ token: number, symbol: string } | undefined> {
  const instruments = await kc.getInstruments("NFO")
  
  // Filter for current symbol and strike
  const filtered = instruments.filter(i => 
    i.name === underlying && 
    Number(i.strike) === strike && 
    i.instrument_type === type &&
    i.segment === "NFO-OPT"
  )

  if (filtered.length === 0) return undefined

  // Sort by expiry to get the nearest one
  const sorted = filtered.sort((a, b) => a.expiry.getTime() - b.expiry.getTime())
  const target = sorted[0]!

  return {
    token: Number(target.instrument_token),
    symbol: target.tradingsymbol
  }
}

export default kc

