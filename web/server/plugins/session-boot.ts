import { sessionManager } from '@core/execution/session-manager.js'
import { userRepo } from '@core/db/repositories/container.js'
import { decryptSecret } from '@core/utils/crypto.js'
import { isMarketOpen } from '@core/utils/market-hours.js'

export default defineNitroPlugin(async () => {
  if (!isMarketOpen()) {
    console.log('[SessionBoot] Market is closed. Skipping session auto-restore.')
    return
  }

  console.log('[SessionBoot] Auto-restoring active sessions...')

  try {
    // Fetch all users with active broker accounts and a watched symbol
    const activeUsers = await userRepo.getActiveWatchingUsers()

    for (const user of activeUsers) {
      try {
        await sessionManager.getSession(
          user.userId,
          decryptSecret(user.accessToken),
          user.apiKey || undefined,
          user.tradeMode
        )
        console.log(`[SessionBoot] ✅ Session restored for user ${user.userId}, watching ${user.watchedSymbol}`)
      } catch (err) {
        console.error(`[SessionBoot] ❌ Failed to restore session for ${user.userId}:`, err)
      }
    }
  } catch (err) {
    console.error(`[SessionBoot] ❌ Error fetching active watching users:`, err)
  }
})
