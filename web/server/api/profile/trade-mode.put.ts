import { serverSupabaseUser } from '#supabase/server'
import { db } from '@core/db/database.js'
import { sessionManager } from '@core/execution/session-manager.js'

export default defineEventHandler(async (event) => {
  const user = await serverSupabaseUser(event)

  if (!user) {
    throw createError({ statusCode: 401, message: 'Unauthorized' })
  }

  const body = await readBody(event)
  const { tradeMode, force } = body

  if (tradeMode !== 'PAPER' && tradeMode !== 'REAL') {
    throw createError({ statusCode: 400, message: 'Invalid trade mode. Must be PAPER or REAL.' })
  }

  // Warning check: REAL -> PAPER with open positions
  if (tradeMode === 'PAPER' && !force) {
    const openTrades = await db
      .selectFrom('trades')
      .select(['id', 'symbol'])
      .where('userId', '=', user.id)
      .where('status', '=', 'OPEN')
      .where('isPaperTrade', '=', false)
      .execute()

    if (openTrades.length > 0) {
      throw createError({
        statusCode: 409,
        statusMessage: 'OPEN_REAL_TRADES',
        message: `You have ${openTrades.length} open REAL positions. Switching to PAPER will cause the AI Risk Manager to stop managing them.`,
      })
    }
  }

  // Update in Database
  await db
    .updateTable('profiles')
    .set({ tradeMode, updatedAt: new Date().toISOString() })
    .where('id', '=', user.id)
    .execute()

  // Dynamically update the active execution session if it exists
  const session = sessionManager.getExistingSession(user.id)
  if (session && session.paperTrader) {
    session.paperTrader.setTradeMode(tradeMode)
  }

  return { success: true, tradeMode }
})
