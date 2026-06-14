import { KiteTicker } from "kiteconnect"

export function createTicker(accessToken: string) {
  const ticker = new KiteTicker({
    api_key: process.env.KITE_API_KEY!,
    access_token: accessToken,
  })

  // Enable auto reconnect with 5 second interval and retry for maximum of 10 times.
  ticker.autoReconnect(true, 10, 5)

  return ticker
}
