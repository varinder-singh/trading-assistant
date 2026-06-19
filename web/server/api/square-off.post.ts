import { serverSupabaseUser } from "#supabase/server"
import { db } from "@core/db/database.js"
import { sessionManager } from "@core/execution/session-manager.js"

export default defineEventHandler(async (event) => {
  const user = await serverSupabaseUser(event)
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Unauthorized" })
  }

  const userId = user.id || user.sub
  if (!userId) {
    throw createError({ statusCode: 401, statusMessage: "Unauthorized (No User ID)" })
  }

  const brokerAccount = await db
    .selectFrom("brokerAccounts")
    .select("accessToken")
    .where("userId", "=", userId)
    .where("isActive", "=", true)
    .executeTakeFirst()

  if (!brokerAccount?.accessToken) {
    throw createError({ statusCode: 400, statusMessage: "Zerodha account not linked." })
  }

  // Retrieve the user's session
  const userSession = await sessionManager.getSession(userId, brokerAccount.accessToken)
  const paperTrader = userSession.paperTrader

  try {
    console.log(`[API ${userId}] Panic Sell triggered. Squaring off all positions...`)
    await paperTrader.squareOffAll("Manual Panic Sell")
    return { success: true, message: "All positions squared off successfully." }
  } catch (error: any) {
    console.error("Square Off API Error:", error)
    throw createError({
      statusCode: 500,
      statusMessage: error.message || "Square off failed",
    })
  }
})
