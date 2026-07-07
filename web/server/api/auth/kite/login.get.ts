import { createKiteClient } from '@core/data/kite.js'
import { serverSupabaseUser } from '#supabase/server'
import { db } from '@core/db/database.js'

export default defineEventHandler(async (event) => {
  const user = await serverSupabaseUser(event)

  if (!user || !(user.id || user.sub)) {
    return sendRedirect(event, '/login')
  }

  const userId = user.id || user.sub
  // Look up user's own api_key from broker_accounts
  const brokerAccount = await db
    .selectFrom('brokerAccounts')
    .select('apiKey')
    .where('userId', '=', userId)
    .where('brokerName', '=', 'zerodha')
    .executeTakeFirst()

  const userApiKey = brokerAccount?.apiKey || undefined

  const kc = createKiteClient(undefined, userApiKey)
  const loginUrl = kc.getLoginURL()

  return sendRedirect(event, loginUrl)
})
