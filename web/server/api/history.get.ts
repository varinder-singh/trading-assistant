import { tradeRepo } from '@core/db/repositories/container.js'
import { serverSupabaseUser } from '#supabase/server'

export default defineEventHandler(async (event) => {
  const user = await serverSupabaseUser(event)
  const userId = user?.id || user?.sub

  if (!userId) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  try {
    const trades = await tradeRepo.getAllTrades(userId)
    return trades
  } catch (error: any) {
    console.error('History API Error:', error)
    throw createError({
      statusCode: 500,
      statusMessage: error.message || 'Failed to fetch trade history',
    })
  }
})
