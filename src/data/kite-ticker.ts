import { KiteTicker } from "kiteconnect"
import { getAccessToken } from "./kite.js"

export function createTicker() {
  const ticker = new KiteTicker({
    api_key: process.env.KITE_API_KEY!,
    access_token: getAccessToken(),
  })

  // Enable auto reconnect with 5 second interval and retry for maximum of 10 times.
  ticker.autoReconnect(true, 10, 5)

  return ticker
}
