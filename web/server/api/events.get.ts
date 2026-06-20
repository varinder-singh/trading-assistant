import { eventRepo } from "@core/db/repositories/event-repo.js"
import { serverSupabaseUser } from "#supabase/server"

export default defineEventHandler(async (event) => {
  const user = await serverSupabaseUser(event)
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Unauthorized" })
  }

  const query = getQuery(event)
  const symbol = (query.symbol as string) || "NIFTY"

  try {
    const events = await eventRepo.getRecentEvents(symbol, 50)
    return events
  } catch (err: any) {
    throw createError({
      statusCode: 500,
      statusMessage: "Failed to fetch analyzer events",
      data: err.message,
    })
  }
})
