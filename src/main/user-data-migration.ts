import { randomUUID } from 'node:crypto'
import { access, chmod, cp, lstat, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, sep } from 'node:path'

export type UserDataMigrationResult = 'migrated' | 'not-required' | 'skipped-existing-user-data'

export type UserDataMigrationOptions = Readonly<{
  legacyDirectory: string
  userDataDirectory: string
  rewriteApplicationStatePaths?(sourceDirectory: string, destinationDirectory: string): Promise<void>
  sqlite?: UserDataMigrationSqlite
}>

type SqliteDatabase = Readonly<{
  close(): void
  exec(sql: string): void
  prepare(sql: string): Readonly<{
    get(...parameters: readonly unknown[]): unknown
    run(...parameters: readonly unknown[]): unknown
  }>
}>

const renameRetryDelayMs = 100
const renameRetryCount = 5

export type UserDataMigrationSqlite = Readonly<{
  DatabaseSync: new (path: string) => SqliteDatabase
}>

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isDirectory()
  } catch {
    return false
  }
}

function isRetryableRenameError(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && 'code' in error && (error.code === 'EBUSY' || error.code === 'EPERM')
  )
}

async function renameWhenAvailable(sourcePath: string, destinationPath: string): Promise<void> {
  for (let attempt = 1; attempt <= renameRetryCount; attempt += 1) {
    try {
      await rename(sourcePath, destinationPath)
      return
    } catch (error) {
      if (!isRetryableRenameError(error) || attempt === renameRetryCount) throw error
      await new Promise<void>((resolve) => setTimeout(resolve, renameRetryDelayMs))
    }
  }
}

function tableExists(database: SqliteDatabase, name: string): boolean {
  return Boolean(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name))
}

async function rewriteApplicationStatePaths(
  sourceDirectory: string,
  storageDirectory: string,
  destinationDirectory: string,
  sqlite?: UserDataMigrationSqlite
): Promise<void> {
  const databasePath = join(storageDirectory, 'application-state.sqlite')

  if (!(await pathExists(databasePath))) return

  const sqliteModule = sqlite ?? ((await import('node:sqlite')) as unknown as UserDataMigrationSqlite)
  const database = new sqliteModule.DatabaseSync(databasePath)
  const sourcePrefix = `${sourceDirectory}${sep}`
  const destinationPrefix = `${destinationDirectory}${sep}`

  try {
    database.exec('BEGIN IMMEDIATE;')

    if (tableExists(database, 'sessions')) {
      database
        .prepare(
          'UPDATE sessions SET expected_jsonl_path = replace(expected_jsonl_path, ?, ?) WHERE expected_jsonl_path LIKE ?'
        )
        .run(sourcePrefix, destinationPrefix, `${sourcePrefix}%`)
    }

    if (tableExists(database, 'external_side_effect_intents')) {
      database
        .prepare(
          'UPDATE external_side_effect_intents SET directory_path = replace(directory_path, ?, ?), session_path = replace(session_path, ?, ?) WHERE directory_path LIKE ? OR session_path LIKE ?'
        )
        .run(sourcePrefix, destinationPrefix, sourcePrefix, destinationPrefix, `${sourcePrefix}%`, `${sourcePrefix}%`)
    }

    database.exec('COMMIT;')
  } catch (error) {
    try {
      database.exec('ROLLBACK;')
    } catch {
      // The database could fail before a transaction is active.
    }

    throw error
  } finally {
    database.close()
  }
}

async function rewriteOwnedSessionHeaders(
  sourceDirectory: string,
  storageDirectory: string,
  destinationDirectory: string
): Promise<void> {
  const sourceSessionDirectory = join(sourceDirectory, 'session-cwd')
  const destinationSessionDirectory = join(destinationDirectory, 'session-cwd')
  const sessionsDirectory = join(storageDirectory, 'sessions')
  const entries = await readdir(sessionsDirectory, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return []

    throw error
  })

  await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
      .map(async (entry) => {
        const sessionPath = join(sessionsDirectory, entry.name)
        const contents = await readFile(sessionPath, 'utf8')
        const firstLineEnd = contents.indexOf('\n')

        if (firstLineEnd === -1) throw new TypeError(`The owned Session file ${entry.name} has no header.`)

        let header: unknown

        try {
          header = JSON.parse(contents.slice(0, firstLineEnd))
        } catch {
          throw new TypeError(`The owned Session file ${entry.name} has an invalid header.`)
        }

        if (
          typeof header !== 'object' ||
          header === null ||
          (header as { type?: unknown }).type !== 'session' ||
          (header as { cwd?: unknown }).cwd !== sourceSessionDirectory
        ) {
          throw new TypeError(`The owned Session file ${entry.name} does not belong to the legacy application data.`)
        }

        const migratedHeader = { ...(header as Record<string, unknown>), cwd: destinationSessionDirectory }
        await writeFile(sessionPath, `${JSON.stringify(migratedHeader)}${contents.slice(firstLineEnd)}`, 'utf8')
      })
  )
}

export async function migrateLegacyUserData({
  legacyDirectory,
  userDataDirectory,
  rewriteApplicationStatePaths: rewritePaths,
  sqlite,
}: UserDataMigrationOptions): Promise<UserDataMigrationResult> {
  if (!(await isDirectory(legacyDirectory))) return 'not-required'
  if (await pathExists(userDataDirectory)) return 'skipped-existing-user-data'

  const stagingDirectory = join(
    dirname(userDataDirectory),
    `.${userDataDirectory.split(sep).at(-1)}-${randomUUID()}.migration`
  )

  await mkdir(dirname(userDataDirectory), { mode: 0o700, recursive: true })

  try {
    await cp(legacyDirectory, stagingDirectory, {
      errorOnExist: true,
      force: false,
      preserveTimestamps: true,
      recursive: true,
      verbatimSymlinks: true,
    })
    await rewriteOwnedSessionHeaders(legacyDirectory, stagingDirectory, userDataDirectory)

    if (rewritePaths) {
      await rewritePaths(legacyDirectory, userDataDirectory)
    } else {
      await rewriteApplicationStatePaths(legacyDirectory, stagingDirectory, userDataDirectory, sqlite)
    }
    await chmod(stagingDirectory, 0o700)
    await renameWhenAvailable(stagingDirectory, userDataDirectory)

    return 'migrated'
  } catch (error) {
    await rm(stagingDirectory, { force: true, recursive: true }).catch(() => {})
    throw error
  }
}
