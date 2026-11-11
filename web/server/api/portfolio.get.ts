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
    return []
  }

  try {
    const userSession = await sessionManager.getSession(
      userId,
      decryptSecret(brokerAccount.accessToken),
      brokerAccount.apiKey,
      tradeMode
    )
    return userSession.paperTrader.getAllPositions()
  } catch (err: any) {
    console.warn(`[Portfolio API] Could not fetch positions for ${userId}:`, err)
    return []
  }
})
