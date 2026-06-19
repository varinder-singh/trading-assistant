import { serverSupabaseUser } from "#supabase/server"
import { db } from "@core/db/database.js"
import { encryptSecret } from "@core/utils/crypto.js"

export default defineEventHandler(async (event) => {
  const user = await serverSupabaseUser(event)
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Unauthorized" })
  }

  const userId = user.id || user.sub

  if (!userId) {
    throw createError({ statusCode: 400, statusMessage: "User ID is missing from session" })
  }

  const body = await readBody(event)
  const { fullName, kiteApiKey, kiteApiSecret } = body

  if (fullName !== undefined && (typeof fullName !== "string" || fullName.trim() === "")) {
    throw createError({ statusCode: 400, statusMessage: "Invalid full name" })
  }

  if ((kiteApiKey && !kiteApiSecret) || (!kiteApiKey && kiteApiSecret)) {
    throw createError({ statusCode: 400, statusMessage: "Both API Key and API Secret must be provided together" })
  }

  try {
    // Upsert logic for profile
    if (fullName !== undefined) {
      const existing = await db.selectFrom("profiles").select("id").where("id", "=", userId).executeTakeFirst()

      if (existing) {
        await db
          .updateTable("profiles")
          .set({
            fullName: fullName.trim(),
            updatedAt: new Date().toISOString(),
          })
          .where("id", "=", userId)
          .execute()
      } else {
        await db
          .insertInto("profiles")
          .values({
            id: userId,
            fullName: fullName.trim(),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          })
          .execute()
      }
    }

    // Upsert logic for broker credentials
    if (kiteApiKey && kiteApiSecret) {
      const existingBroker = await db
        .selectFrom("brokerAccounts")
        .select("id")
        .where("userId", "=", userId)
        .where("brokerName", "=", "zerodha")
        .executeTakeFirst()

      const encryptedSecret = encryptSecret(kiteApiSecret)

      if (existingBroker) {
        await db
          .updateTable("brokerAccounts")
          .set({
            apiKey: kiteApiKey,
            apiSecretEncrypted: encryptedSecret,
            updatedAt: new Date().toISOString(),
          })
          .where("id", "=", existingBroker.id)
          .execute()
      } else {
        await db
          .insertInto("brokerAccounts")
          .values({
            id: crypto.randomUUID(),
            userId: userId,
            brokerName: "zerodha",
            brokerUserId: "", // Will be filled upon successful OAuth login
            accessToken: "", // Will be filled upon successful OAuth login
            apiKey: kiteApiKey,
            apiSecretEncrypted: encryptedSecret,
            isActive: false, // Remains false until successful OAuth login
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          })
          .execute()
      }
    }

    return { success: true, message: "Profile updated successfully" }
  } catch (error: any) {
    console.error("Error updating profile:", error)
    throw createError({
      statusCode: 500,
      statusMessage: `Failed to update profile: ${error.message || error}`,
    })
  }
})
