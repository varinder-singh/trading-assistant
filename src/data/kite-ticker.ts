import { KiteTicker } from "kiteconnect"
import { getAccessToken } from "./kite.js"

export function createTicker() {
  const ticker = new KiteTicker({
    api_key: process.env.KITE_API_KEY!,
    access_token: getAccessToken(),
  })

  return ticker
}
