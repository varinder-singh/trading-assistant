import * as path from 'node:path'
import { promises as fs } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Migrator, FileMigrationProvider } from 'kysely/migration'
import { db } from './database.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

async function migrateToLatest(): Promise<void> {
  const migrator = new Migrator({
    db,
    provider: new FileMigrationProvider({
      fs,
      path,
      migrationFolder: path.join(__dirname, 'migrations'),
    }),
  })

  const { error, results } = await migrator.migrateToLatest()

  results?.forEach((it) => {
    const msg =
      it.status === 'Success'
        ? `✅ Migration "${it.migrationName}" was executed successfully`
        : `❌ Failed to execute migration "${it.migrationName}"`
    console.log(msg)
  })

  if (error) {
    console.error('❌ Failed to migrate')
    console.error(error)
    await db.destroy()
    process.exit(1)
  }

  await db.destroy()
}

migrateToLatest()
