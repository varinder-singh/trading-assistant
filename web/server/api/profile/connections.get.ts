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

  try {
    const connections = await db
      .selectFrom('brokerAccounts')
      .select(['id', 'brokerName', 'brokerUserId', 'isActive', 'updatedAt', 'apiKey', 'apiSecretEncrypted'])
      .where('userId', '=', userId)
      .execute()

    return connections.map((c) => ({
      id: c.id,
      brokerName: c.brokerName,
      brokerUserId: c.brokerUserId,
      isActive: c.isActive,
      updatedAt: c.updatedAt,
      apiKey: c.apiKey,
      hasApiSecret: !!c.apiSecretEncrypted,
    }))
  } catch (error: any) {
    console.error('Error fetching broker connections:', error)
    throw createError({
      statusCode: 500,
      statusMessage: `Failed to fetch broker connections: ${error.message || error}`,
    })
  }
})
