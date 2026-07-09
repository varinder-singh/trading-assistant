import { getMultiTimeframeCandles } from '@core/data/yahoo.js'
import { isMarketOpen, getMarketStatusMessage } from '@core/utils/market-hours.js'
import { serverSupabaseUser } from '#supabase/server'
import { userRepo } from '@core/db/repositories/container.js'
import { sessionManager } from '@core/execution/session-manager.js'
import { decryptSecret } from '@core/utils/crypto.js'

export default defineEventHandler(async (event) => {
  const user = await serverSupabaseUser(event)
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const userId = user.id || user.sub
  if (!userId) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized (No User ID)' })
  }

  const query = getQuery(event)
  const symbol = (query.symbol as string) || 'NIFTY'

  // Retrieve user Kite Connect client instance if available in session
  let kc: any = undefined
  try {
    const profile = await userRepo.getUserProfileByUserId(userId)
    const tradeMode = profile?.tradeMode || 'PAPER'
    const brokerAccount = await userRepo.getUserBrokerAccountByUserId(userId)

    if (brokerAccount?.accessToken && brokerAccount?.apiKey) {
      const userSession = await sessionManager.getSession(
        userId,
        decryptSecret(brokerAccount.accessToken),
        brokerAccount.apiKey,
        tradeMode
      )
      kc = userSession.kc
    }
  } catch (err) {
    console.warn(`[Chart Data API] Could not retrieve Kite client session for ${symbol}:`, err)
  }

  try {
    const data = await getMultiTimeframeCandles(symbol, kc)
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
      statusMessage: error.message || 'Failed to fetch chart data',
    })
  }
})
