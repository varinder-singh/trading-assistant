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

  const profile = await userRepo.getUserProfileByUserId(userId)

  const tradeMode = profile?.tradeMode || 'PAPER'

  const brokerAccount = await userRepo.getUserBrokerAccountByUserId(userId)

  if (!brokerAccount?.accessToken || !brokerAccount?.apiKey) {
    throw createError({ statusCode: 400, statusMessage: 'Zerodha account not linked or incomplete.' })
  }

  // Retrieve the user's session
  const userSession = await sessionManager.getSession(
    userId,
    decryptSecret(brokerAccount.accessToken),
    brokerAccount.apiKey,
    tradeMode
  )
  const paperTrader = userSession.paperTrader

  try {
    console.log(`[API ${userId}] Panic Sell triggered. Squaring off all positions...`)
    await paperTrader.squareOffAll('Manual Panic Sell')
    return { success: true, message: 'All positions squared off successfully.' }
  } catch (error: any) {
    console.error('Square Off API Error:', error)
    throw createError({
      statusCode: 500,
      statusMessage: error.message || 'Square off failed',
    })
  }
})
