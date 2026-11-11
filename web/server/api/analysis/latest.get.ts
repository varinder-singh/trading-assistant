import { serverSupabaseUser } from '#supabase/server'
import { analysisSnapshotRepo } from '@core/db/repositories/container.js'

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

  const snapshot = await analysisSnapshotRepo.getLatestSnapshot(userId, symbol)
  return { snapshot }
})
