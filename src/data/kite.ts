import { KiteConnect } from "kiteconnect"
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

type CachedKiteToken = {
  accessToken?: string
}

const tokenFilePath = resolve(process.cwd(), ".kite", "access-token.json")

function readCachedAccessToken() {
  if (!existsSync(tokenFilePath)) {
    return undefined
  }

  const cachedToken = JSON.parse(readFileSync(tokenFilePath, "utf8")) as CachedKiteToken
  return cachedToken.accessToken
}

function getAccessToken() {
  const accessToken = readCachedAccessToken() ?? process.env.KITE_ACCESS_TOKEN

  if (!accessToken) {
    throw new Error("KITE_ACCESS_TOKEN is missing. Run `npm run kite:token` to generate a fresh token.")
  }

  return accessToken
}

const kc = new KiteConnect({
  api_key: process.env.KITE_API_KEY!,
})

kc.setAccessToken(getAccessToken())

export default kc
