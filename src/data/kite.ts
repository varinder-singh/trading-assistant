import "dotenv/config"
import { KiteConnect } from "kiteconnect"

const apiKey = process.env.KITE_API_KEY
if (!apiKey) {
  throw new Error("KITE_API_KEY is missing in environment variables. Check your .env file.")
}

/**
 * Creates a new KiteConnect client instance.
 * For OAuth login, you can create it without an access token.
 * For making API requests, pass the user's access token.
 */
export function createKiteClient(accessToken?: string) {
  const kc = new KiteConnect({
    api_key: apiKey!,
  })

  if (accessToken) {
    kc.setAccessToken(accessToken)
  }

  return kc
}

export async function getInstrumentToken(kc: KiteConnect, symbol: string): Promise<number | undefined> {
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

export async function getOptionToken(kc: KiteConnect, underlying: string, strike: number, type: "CE" | "PE"): Promise<{ token: number, symbol: string } | undefined> {
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
export default createKiteClient(process.env.KITE_ACCESS_TOKEN)
