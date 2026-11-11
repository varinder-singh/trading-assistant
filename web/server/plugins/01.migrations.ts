import { runMigrations } from '@core/db/migration-runner.js'

export default defineNitroPlugin(async () => {
  try {
    console.log('[Nitro Plugin] 🗄️ Checking and applying database migrations on startup...')
    const { error, results } = await runMigrations()
    if (error) {
      console.error('[Nitro Plugin] ❌ Migration failed on startup:', error)
    } else {
      const executed = results?.filter((r) => r.status === 'Success') ?? []
      if (executed.length > 0) {
        console.log(`[Nitro Plugin] ✅ Applied ${executed.length} pending migration(s) successfully.`)
      } else {
        console.log('[Nitro Plugin] ✅ Database schema is already up to date.')
      }
    }
  } catch (err) {
    console.error('[Nitro Plugin] ❌ Unexpected error during database migration on startup:', err)
  }
})
