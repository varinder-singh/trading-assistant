import { createKiteClient } from "@core/data/kite.js"
import { serverSupabaseUser } from "#supabase/server"
import { db } from "@core/db/database.js"
import crypto from "node:crypto"
import { decryptSecret } from "@core/utils/crypto.js"

export default defineEventHandler(async (event) => {
  const user = await serverSupabaseUser(event)
  if (!user) {
    return sendRedirect(event, "/login")
  }

  const query = getQuery(event)
  const requestToken = query.request_token as string

  if (!requestToken) {
    throw createError({ statusCode: 400, statusMessage: "Missing request_token" })
  }

  const userId = user.id || user.sub

  if (!userId) {
    throw createError({ statusCode: 500, statusMessage: `User ID is missing! User object: ${JSON.stringify(user)}` })
  }

  try {
    // Check if the user already has a broker account
    const existing = await db
      .selectFrom("brokerAccounts")
      .select(["id", "apiKey", "apiSecretEncrypted"])
      .where("userId", "=", userId)
      .where("brokerName", "=", "zerodha")
      .executeTakeFirst()

    const userApiKey = existing?.apiKey || undefined
    const userApiSecret = existing?.apiSecretEncrypted
      ? decryptSecret(existing.apiSecretEncrypted)
      : process.env.KITE_API_SECRET!

    const kc = createKiteClient(undefined, userApiKey)
    const response = await kc.generateSession(requestToken, userApiSecret)

    const accessToken = response.access_token
    const publicToken = response.public_token
    const brokerUserId = response.user_id

    // Ensure the user profile exists to satisfy the foreign key constraint
    const profile = await db.selectFrom("profiles").select("id").where("id", "=", userId).executeTakeFirst()

    if (!profile) {
      await db
        .insertInto("profiles")
        .values({
          id: userId,
          fullName: user.email ? user.email.split("@")[0] : "Trader",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .execute()
    }

    // User profile creation logic is above

    if (existing) {
      await db
        .updateTable("brokerAccounts")
        .set({
          accessToken,
          publicToken,
          brokerUserId,
          isActive: true,
          updatedAt: new Date().toISOString(),
        })
        .where("id", "=", existing.id)
        .execute()
    } else {
      console.log("[KITE CALLBACK] user object:", user)
      console.log("[KITE CALLBACK] user.id:", user.id)
      await db
        .insertInto("brokerAccounts")
        .values({
          id: crypto.randomUUID(),
          userId: userId,
          brokerName: "zerodha",
          brokerUserId,
          accessToken,
          publicToken,
          isActive: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .execute()
    }

    // Redirect to dashboard on success
    return sendRedirect(event, "/")
  } catch (error: any) {
    console.error("Zerodha OAuth Error:", error)
    throw createError({
      statusCode: 500,
      statusMessage: `Failed to authenticate with Zerodha: ${error.message || error}`,
    })
  }
})
