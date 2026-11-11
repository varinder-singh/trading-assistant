import { Migrator, type Migration, type MigrationProvider } from 'kysely/migration'
import { db } from './database.js'
import * as m001 from './migrations/001_initial_schema.js'
import * as m007 from './migrations/007_add_analyzer_events.js'
import * as m009 from './migrations/009_add_iv_history.js'
import * as m010 from './migrations/010_add_broker_api_credentials.js'
import * as m011 from './migrations/011_add_profile_trade_mode.js'
import * as m012 from './migrations/012_alter_gti_scores_candletime.js'
import * as m013 from './migrations/013_add_watch_config_to_profiles.js'
import * as m014 from './migrations/014_add_equity_and_universe_preferences.js'
import * as m015 from './migrations/015_create_scanner_and_analysis_persistence.js'

export const staticMigrationProvider: MigrationProvider = {
  async getMigrations(): Promise<Record<string, Migration>> {
    return {
      '001_initial_schema': m001,
      '007_add_analyzer_events': m007,
      '009_add_iv_history': m009,
      '010_add_broker_api_credentials': m010,
      '011_add_profile_trade_mode': m011,
      '012_alter_gti_scores_candletime': m012,
      '013_add_watch_config_to_profiles': m013,
      '014_add_equity_and_universe_preferences': m014,
      '015_create_scanner_and_analysis_persistence': m015,
    }
  },
}

export async function runMigrations(): Promise<{ error?: any; results?: any }> {
  const migrator = new Migrator({
    db,
    provider: staticMigrationProvider,
  })

  const { error, results } = await migrator.migrateToLatest()

  const logMessages = results?.map((it) =>
    it.status === 'Success'
      ? `✅ Migration "${it.migrationName}" was executed successfully`
      : `❌ Failed to execute migration "${it.migrationName}"`
  )
  if (logMessages && logMessages.length > 0) {
    console.log('[DB Migrator]', logMessages.join('\n[DB Migrator] '))
  }

  if (error) {
    console.error('[DB Migrator] ❌ Failed to execute database migrations:', error)
  }

  return { error, results }
}
