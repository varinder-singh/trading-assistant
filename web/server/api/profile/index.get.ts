import { serverSupabaseUser } from "#supabase/server"
import { db } from "@core/db/database.js"

export default defineEventHandler(async (event) => {
  const user = await serverSupabaseUser(event)
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Unauthorized" })
  }

  const userId = user.id || user.sub

  if (!userId) {
    throw createError({ statusCode: 400, statusMessage: "User ID is missing from session" })
  }

  try {
    const profile = await db.selectFrom("profiles").selectAll().where("id", "=", userId).executeTakeFirst()

    if (!profile) {
      // Return a default structure if profile hasn't been created yet by the Kite callback
      return {
        id: userId,
        fullName: user.email ? user.email.split("@")[0] : "Trader",
        email: user.email,
        createdAt: new Date().toISOString(),
      }
    }

    return {
      ...profile,
      email: user.email, // Include email from Supabase Auth
    }
  } catch (error: any) {
    console.error("Error fetching profile:", error)
    throw createError({
      statusCode: 500,
      statusMessage: `Failed to fetch profile: ${error.message || error}`,
    })
  }
})
