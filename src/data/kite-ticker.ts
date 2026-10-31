import { KiteTicker } from "kiteconnect"

export function createTicker(accessToken: string, apiKey?: string) {
  const resolvedApiKey = apiKey || process.env.KITE_API_KEY
  if (!resolvedApiKey) {
    throw new Error("No Kite API key available. Provide one or set KITE_API_KEY env var.")
  }

  const ticker = new KiteTicker({
    api_key: resolvedApiKey,
    access_token: accessToken,
  })

  // Enable auto reconnect with 5 second interval and retry for maximum of 10 times.
  ticker.autoReconnect(true, 10, 5)

  return ticker
}
