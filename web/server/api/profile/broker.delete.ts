import { serverSupabaseUser } from '#supabase/server'
import { db } from '@core/db/database.js'

export default defineEventHandler(async (event) => {
  const user = await serverSupabaseUser(event)
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const userId = user.id || user.sub
  if (!userId) {
    throw createError({ statusCode: 400, statusMessage: 'User ID is missing from session' })
  }

  const query = getQuery(event)
  const brokerName = (query.name as string)?.toLowerCase()

  if (!brokerName) {
    throw createError({ statusCode: 400, statusMessage: 'Broker name is required' })
  }

  try {
    const result = await db
      .deleteFrom('brokerAccounts')
      .where('userId', '=', userId)
      .where('brokerName', '=', brokerName)
      .executeTakeFirst()

    return {
      success: true,
      message: `Disconnected ${brokerName} successfully`,
      deleted: Number(result.numDeletedRows ?? 0) > 0,
    }
  } catch (error: any) {
    console.error(`Error deleting broker account ${brokerName}:`, error)
    throw createError({
      statusCode: 500,
      statusMessage: `Failed to disconnect broker: ${error.message || error}`,
    })
  }
})
