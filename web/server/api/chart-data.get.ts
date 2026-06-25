import { getMultiTimeframeCandles } from "@core/data/yahoo.js"
import { isMarketOpen, getMarketStatusMessage } from "@core/utils/market-hours.js"
import { resolveYahooTicker } from "@core/utils/symbol.js"
import { serverSupabaseUser } from "#supabase/server"

export default defineEventHandler(async (event) => {
  const user = await serverSupabaseUser(event)
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Unauthorized" })
  }

  const query = getQuery(event)
  const symbol = (query.symbol as string) || "NIFTY"
  const ticker = resolveYahooTicker(symbol)

  try {
    const data = await getMultiTimeframeCandles(ticker)
    return {
      isMarketOpen: isMarketOpen(),
      marketStatusMessage: getMarketStatusMessage(),
      candles1h: data.candles1h.slice(-100),
      candles30m: data.candles30m ? data.candles30m.slice(-100) : data.candles15m.slice(-100),
      candles15m: data.candles15m.slice(-100),
      candles3m: data.candles3m.slice(-100),
    }
  } catch (error: any) {
    throw createError({
      statusCode: 500,
      statusMessage: error.message || "Failed to fetch chart data",
    })
  }
})
