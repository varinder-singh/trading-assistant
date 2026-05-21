import "dotenv/config"
import { spawn } from "node:child_process"
import { chmodSync, mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { createInterface } from "node:readline/promises"
import { stdin as input, stdout as output } from "node:process"
import { KiteConnect } from "kiteconnect"

import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const tokenFilePath = resolve(__dirname, "../../.kite", "access-token.json")

function getRequiredEnv(name: string) {
  const value = process.env[name]

  if (!value) {
    throw new Error(`${name} is required`)
  }

  return value
}

function getArgValue(flag: string) {
  const flagIndex = process.argv.indexOf(flag)

  if (flagIndex === -1) {
    return undefined
  }

  return process.argv[flagIndex + 1]
}

function parseRequestToken(value: string) {
  const trimmedValue = value.trim()

  if (!trimmedValue) {
    return undefined
  }

  try {
    const redirectedUrl = new URL(trimmedValue)
    return redirectedUrl.searchParams.get("request_token") ?? undefined
  } catch {
    return trimmedValue
  }
}

function openLoginUrl(loginUrl: string) {
  const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open"
  const args = process.platform === "win32" ? ["/c", "start", "", loginUrl] : [loginUrl]
  const child = spawn(opener, args, {
    detached: true,
    stdio: "ignore",
  })

  child.unref()
}

function saveAccessToken(accessToken: string) {
  mkdirSync(dirname(tokenFilePath), { recursive: true })
  writeFileSync(
    tokenFilePath,
    `${JSON.stringify(
      {
        accessToken,
        generatedAt: new Date().toISOString(),
      },
      null,
      2
    )}\n`,
    { mode: 0o600 }
  )
  chmodSync(tokenFilePath, 0o600)
}

async function readRequestToken(loginUrl: string) {
  const requestTokenArg = getArgValue("--request-token") ?? getArgValue("-r")
  const requestTokenFromArg = requestTokenArg ? parseRequestToken(requestTokenArg) : undefined

  if (requestTokenFromArg) {
    return requestTokenFromArg
  }

  console.log("Kite login URL:")
  console.log(loginUrl)

  if (!process.argv.includes("--no-open")) {
    try {
      openLoginUrl(loginUrl)
    } catch {
      console.log("Could not open the browser automatically. Open the URL above manually.")
    }
  }

  console.log("\nAfter login, paste the full redirected URL or only the request_token value.")

  const readline = createInterface({ input, output })
  const pastedValue = await readline.question("request_token / redirected URL: ")
  readline.close()

  const requestToken = parseRequestToken(pastedValue)

  if (!requestToken) {
    throw new Error("Could not find request_token")
  }

  return requestToken
}

async function run() {
  const kc = new KiteConnect({
    api_key: getRequiredEnv("KITE_API_KEY"),
  })

  const requestToken = await readRequestToken(kc.getLoginURL())
  const session = await kc.generateSession(requestToken, getRequiredEnv("KITE_API_SECRET"))

  saveAccessToken(session.access_token)

  console.log(`\nSaved Kite access token to ${tokenFilePath}`)
  console.log("Run your trade CLI in the same project without updating ~/.zshrc.")
}

run().catch(console.error)
