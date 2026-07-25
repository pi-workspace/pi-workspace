import assert from 'node:assert/strict'
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'
import { tmpdir } from 'node:os'
import { migrateLegacyUserData, type UserDataMigrationSqlite } from './user-data-migration'

type BunSqliteModule = Readonly<{
  Database: UserDataMigrationSqlite['DatabaseSync']
}>

const { Database } = (await Function('return import("bun:sqlite")')()) as BunSqliteModule
const bunSqlite: UserDataMigrationSqlite = { DatabaseSync: Database }
const temporaryDirectories: string[] = []

afterEach(async () => {
  const directories = temporaryDirectories.splice(0)
  // Bun's SQLite adapter retains database handles until the test process ends on Windows.
  if (process.platform === 'win32') return

  await Promise.all(directories.map((directory) => rm(directory, { force: true, recursive: true, maxRetries: 5 })))
})

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'railyard-user-data-migration-'))
  temporaryDirectories.push(directory)
  return directory
}

test('copies legacy application data into the Railyard directory and updates owned Session paths', async () => {
  const root = await createTemporaryDirectory()
  const legacyDirectory = join(root, 'Pi Workspace')
  const railyardDirectory = join(root, 'Railyard')
  const legacySessionDirectory = join(legacyDirectory, 'session-cwd')
  const legacySessionPath = join(legacyDirectory, 'sessions', 'session-a.jsonl')
  let rewrittenPaths: Readonly<{ sourceDirectory: string; destinationDirectory: string }> | undefined

  await mkdir(legacySessionDirectory, { recursive: true })
  await mkdir(join(legacyDirectory, 'sessions'), { recursive: true })
  await writeFile(
    legacySessionPath,
    `${JSON.stringify({ type: 'session', version: 3, id: 'session-a', timestamp: '2026-07-25T00:00:00.000Z', cwd: legacySessionDirectory })}\n{"type":"message"}\n`
  )

  const result = await migrateLegacyUserData({
    legacyDirectory,
    userDataDirectory: railyardDirectory,
    rewriteApplicationStatePaths: async (sourceDirectory, destinationDirectory) => {
      rewrittenPaths = { sourceDirectory, destinationDirectory }
    },
  })

  assert.equal(result, 'migrated')
  assert.deepEqual(rewrittenPaths, {
    sourceDirectory: legacyDirectory,
    destinationDirectory: railyardDirectory,
  })

  const migratedContents = await readFile(join(railyardDirectory, 'sessions', 'session-a.jsonl'), 'utf8')
  const [header] = migratedContents.split('\n')
  assert.equal(JSON.parse(header ?? '{}').cwd, join(railyardDirectory, 'session-cwd'))

  const legacyContents = await readFile(legacySessionPath, 'utf8')
  const [legacyHeader] = legacyContents.split('\n')
  assert.equal(JSON.parse(legacyHeader ?? '{}').cwd, legacySessionDirectory)
})

test('rewrites copied application-state Session paths to the Railyard directory', async () => {
  const root = await createTemporaryDirectory()
  const legacyDirectory = join(root, 'Pi Workspace')
  const railyardDirectory = join(root, 'Railyard')
  const legacySessionPath = join(legacyDirectory, 'sessions', 'session-a.jsonl')
  const railyardSessionPath = join(railyardDirectory, 'sessions', 'session-a.jsonl')
  const legacySessionDirectory = join(legacyDirectory, 'session-cwd')
  const railyardSessionDirectory = join(railyardDirectory, 'session-cwd')

  await mkdir(legacyDirectory, { recursive: true })
  const database = new Database(join(legacyDirectory, 'application-state.sqlite'))
  database.exec(
    'CREATE TABLE sessions (expected_jsonl_path TEXT NOT NULL); CREATE TABLE external_side_effect_intents (directory_path TEXT NOT NULL, session_path TEXT NOT NULL);'
  )
  database.prepare('INSERT INTO sessions (expected_jsonl_path) VALUES (?)').run(legacySessionPath)
  database
    .prepare('INSERT INTO external_side_effect_intents (directory_path, session_path) VALUES (?, ?)')
    .run(legacySessionDirectory, legacySessionPath)
  database.close()

  const result = await migrateLegacyUserData({
    legacyDirectory,
    userDataDirectory: railyardDirectory,
    sqlite: bunSqlite,
  })

  assert.equal(result, 'migrated')

  const migratedDatabase = new Database(join(railyardDirectory, 'application-state.sqlite'))
  const migratedSession = migratedDatabase.prepare('SELECT expected_jsonl_path FROM sessions').get() as {
    expected_jsonl_path: string
  }
  const migratedIntent = migratedDatabase
    .prepare('SELECT directory_path, session_path FROM external_side_effect_intents')
    .get() as { directory_path: string; session_path: string }

  assert.equal(migratedSession.expected_jsonl_path, railyardSessionPath)
  assert.equal(migratedIntent.directory_path, railyardSessionDirectory)
  assert.equal(migratedIntent.session_path, railyardSessionPath)
  migratedDatabase.close()
})

test('does not merge legacy application data into an existing Railyard directory', async () => {
  const root = await createTemporaryDirectory()
  const legacyDirectory = join(root, 'Pi Workspace')
  const railyardDirectory = join(root, 'Railyard')
  let rewroteApplicationStatePaths = false

  await mkdir(legacyDirectory)
  await mkdir(railyardDirectory)
  await writeFile(join(railyardDirectory, 'settings.json'), '{}\n')

  const result = await migrateLegacyUserData({
    legacyDirectory,
    userDataDirectory: railyardDirectory,
    rewriteApplicationStatePaths: async () => {
      rewroteApplicationStatePaths = true
    },
  })

  assert.equal(result, 'skipped-existing-user-data')
  assert.equal(rewroteApplicationStatePaths, false)
  await access(legacyDirectory)
})

test('does not create a Railyard directory when no legacy application data exists', async () => {
  const root = await createTemporaryDirectory()
  const result = await migrateLegacyUserData({
    legacyDirectory: join(root, 'Pi Workspace'),
    userDataDirectory: join(root, 'Railyard'),
  })

  assert.equal(result, 'not-required')
  await assert.rejects(access(join(root, 'Railyard')))
})
