import { serverSupabaseUser } from '#supabase/server'
import { scannerAlertRepo } from '@core/db/repositories/container.js'

export default defineEventHandler(async (event) => {
  const user = await serverSupabaseUser(event)
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const query = getQuery(event)
  const tradingDate = (query.date as string) || new Date().toISOString().split('T')[0]!
  const limit = query.limit ? Number(query.limit) : 50

  const alerts = await scannerAlertRepo.getTodayAlerts(tradingDate, limit)
  return { alerts }
})
