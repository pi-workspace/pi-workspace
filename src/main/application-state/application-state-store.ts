import { randomUUID } from 'node:crypto'
import { access, rename } from 'node:fs/promises'
import { join } from 'node:path'
import {
  applicationStateSchemaVersion,
  classifyApplicationState,
  type ApplicationStateMetadata,
  type ApplicationStateStartup,
  type InstallationMarker,
} from '@/src/application-state'
import {
  ensurePrivateDirectory,
  ensurePrivateFile,
  readPrivateTextFile,
  writePrivateTextFile,
} from '@/src/main/private-storage'
import { workstreamKnowledgeSchemaSql, workstreamKnowledgeTableNames } from './workstream-knowledge-store'
import type { SqliteDatabase, SqliteModule } from './sqlite'

export async function loadSqlite(): Promise<SqliteModule> {
  // Bun cannot resolve node:sqlite. Electron's Node 24 runtime resolves it here.
  return Function('return import("node:sqlite")')() as Promise<SqliteModule>
}

const markerFileName = 'application-state.json'
const databaseFileName = 'application-state.sqlite'
const renameRetryDelayMs = 100
const renameRetryCount = 5

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
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

async function readMarker(markerPath: string): Promise<InstallationMarker | undefined> {
  try {
    const value: unknown = JSON.parse(await readPrivateTextFile(markerPath))

    return typeof value === 'object' &&
      value !== null &&
      typeof (value as { generationId?: unknown }).generationId === 'string'
      ? { generationId: (value as { generationId: string }).generationId }
      : undefined
  } catch {
    return undefined
  }
}

function tableExists(database: SqliteDatabase, name: string): boolean {
  return Boolean(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name))
}

function columnExists(database: SqliteDatabase, table: string, column: string): boolean {
  return database
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .some((row) => row.name === column)
}

function migrateApplicationState(database: SqliteDatabase): void {
  database.exec('PRAGMA foreign_keys = ON;')
  const schemaVersion = Number(database.prepare("SELECT value FROM metadata WHERE key = 'schema_version'").get()?.value)

  if (schemaVersion !== 3 && schemaVersion !== 4 && schemaVersion !== 5) return

  database.exec('BEGIN IMMEDIATE;')

  try {
    if (schemaVersion <= 4 && tableExists(database, 'workstream_run_leases')) {
      database.exec(`
        CREATE TABLE session_run_leases_new (session_id TEXT PRIMARY KEY REFERENCES sessions(id), workstream_id TEXT NOT NULL REFERENCES workstreams(id), lease_id TEXT NOT NULL UNIQUE, purpose TEXT NOT NULL, acquired_at INTEGER NOT NULL);
        INSERT INTO session_run_leases_new (session_id, workstream_id, lease_id, purpose, acquired_at)
        SELECT session_id, workstream_id, lease_id, purpose, acquired_at FROM workstream_run_leases;
        DROP TABLE workstream_run_leases;
        ALTER TABLE session_run_leases_new RENAME TO session_run_leases;
      `)
    } else if (schemaVersion <= 4 && !tableExists(database, 'session_run_leases')) {
      database.exec(
        'CREATE TABLE session_run_leases (session_id TEXT PRIMARY KEY REFERENCES sessions(id), workstream_id TEXT NOT NULL REFERENCES workstreams(id), lease_id TEXT NOT NULL UNIQUE, purpose TEXT NOT NULL, acquired_at INTEGER NOT NULL);'
      )
    }

    if (schemaVersion <= 4 && !tableExists(database, 'session_repository_locations')) {
      database.exec(
        `CREATE TABLE session_repository_locations (session_id TEXT NOT NULL REFERENCES sessions(id), repository_id TEXT NOT NULL REFERENCES repositories(id), kind TEXT NOT NULL, working_path TEXT NOT NULL, branch TEXT, base_commit TEXT, availability TEXT NOT NULL, PRIMARY KEY (session_id, repository_id));`
      )
    }

    if (schemaVersion <= 4) {
      database.exec(`
        INSERT INTO session_repository_locations
          (session_id, repository_id, kind, working_path, branch, base_commit, availability)
        SELECT session.id, location.repository_id, location.kind, location.working_path,
               location.branch, location.base_commit, location.availability
          FROM sessions session
          JOIN workstream_repository_locations location ON location.workstream_id = session.workstream_id
         WHERE (
                 session.access_kind = 'managed' AND session.id = (
                   SELECT first_session.id
                     FROM sessions first_session
                    WHERE first_session.workstream_id = session.workstream_id
                    ORDER BY first_session.created_at, first_session.rowid
                    LIMIT 1
                 )
               )
            OR session.repository_id = location.repository_id
        ON CONFLICT (session_id, repository_id) DO NOTHING;
      `)
    }

    if (!columnExists(database, 'sessions', 'parent_session_id')) {
      database.exec('ALTER TABLE sessions ADD COLUMN parent_session_id TEXT REFERENCES sessions(id);')
    }
    if (!columnExists(database, 'sessions', 'forked_from_entry_id')) {
      database.exec('ALTER TABLE sessions ADD COLUMN forked_from_entry_id TEXT;')
    }

    database
      .prepare("UPDATE metadata SET value = ? WHERE key = 'schema_version'")
      .run(String(applicationStateSchemaVersion))
    incrementRevision(database)
    database.exec('COMMIT;')
  } catch (error) {
    database.exec('ROLLBACK;')
    throw error
  }
}

function initializeSchema(database: SqliteDatabase, generationId: string): void {
  database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    BEGIN IMMEDIATE;
    CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, metadata_revision INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE repositories (id TEXT PRIMARY KEY, directory_path TEXT NOT NULL UNIQUE, common_directory_path TEXT NOT NULL, availability TEXT NOT NULL DEFAULT 'available');
    CREATE TABLE workspace_repositories (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), repository_id TEXT NOT NULL REFERENCES repositories(id), role TEXT NOT NULL DEFAULT '', relationships TEXT NOT NULL DEFAULT '[]', validation_commands TEXT NOT NULL DEFAULT '[]', UNIQUE(workspace_id, repository_id));
    CREATE TABLE workstreams (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), goal TEXT, lifecycle TEXT NOT NULL, working_location TEXT NOT NULL, working_location_revision INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
    CREATE TABLE sessions (id TEXT PRIMARY KEY, workstream_id TEXT NOT NULL REFERENCES workstreams(id), title TEXT NOT NULL, mode TEXT NOT NULL, availability TEXT NOT NULL, access_kind TEXT NOT NULL, repository_id TEXT REFERENCES repositories(id), pi_session_id TEXT NOT NULL UNIQUE, expected_jsonl_path TEXT NOT NULL UNIQUE, creation_status TEXT NOT NULL, created_at INTEGER NOT NULL, parent_session_id TEXT REFERENCES sessions(id), forked_from_entry_id TEXT);
    CREATE TABLE workstream_repository_locations (workstream_id TEXT NOT NULL REFERENCES workstreams(id), repository_id TEXT NOT NULL REFERENCES repositories(id), kind TEXT NOT NULL, working_path TEXT NOT NULL, branch TEXT, base_commit TEXT, availability TEXT NOT NULL, PRIMARY KEY (workstream_id, repository_id));
    CREATE TABLE session_run_leases (session_id TEXT PRIMARY KEY REFERENCES sessions(id), workstream_id TEXT NOT NULL REFERENCES workstreams(id), lease_id TEXT NOT NULL UNIQUE, purpose TEXT NOT NULL, acquired_at INTEGER NOT NULL);
    CREATE TABLE session_repository_locations (session_id TEXT NOT NULL REFERENCES sessions(id), repository_id TEXT NOT NULL REFERENCES repositories(id), kind TEXT NOT NULL, working_path TEXT NOT NULL, branch TEXT, base_commit TEXT, availability TEXT NOT NULL, PRIMARY KEY (session_id, repository_id));
    CREATE TABLE external_side_effect_intents (id TEXT PRIMARY KEY, kind TEXT NOT NULL, status TEXT NOT NULL, session_id TEXT NOT NULL REFERENCES sessions(id), pi_session_id TEXT NOT NULL, directory_path TEXT NOT NULL, session_path TEXT NOT NULL);
    ${workstreamKnowledgeSchemaSql}
    INSERT INTO metadata (key, value) VALUES ('generation_id', '${generationId}'), ('schema_version', '${applicationStateSchemaVersion}'), ('revision', '0');
    COMMIT;
  `)
}

function readMetadata(database: SqliteDatabase): ApplicationStateMetadata | undefined {
  try {
    database.exec('PRAGMA foreign_keys = ON;')
    const schemaVersion = database.prepare("SELECT value FROM metadata WHERE key = 'schema_version'").get()?.value
    const schemaVersionNumber = typeof schemaVersion === 'string' ? Number(schemaVersion) : Number.NaN

    for (const table of [
      'repositories',
      'workspace_repositories',
      'workstream_repository_locations',
      ...workstreamKnowledgeTableNames,
    ]) {
      database.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get()
    }
    database.prepare('SELECT name, metadata_revision FROM workspaces LIMIT 1').get()
    database
      .prepare(
        'SELECT goal, lifecycle, working_location, working_location_revision, created_at FROM workstreams LIMIT 1'
      )
      .get()
    database
      .prepare(
        schemaVersionNumber >= 6
          ? 'SELECT mode, availability, access_kind, repository_id, pi_session_id, expected_jsonl_path, creation_status, created_at, parent_session_id, forked_from_entry_id FROM sessions LIMIT 1'
          : 'SELECT mode, availability, access_kind, repository_id, pi_session_id, expected_jsonl_path, creation_status, created_at FROM sessions LIMIT 1'
      )
      .get()
    database
      .prepare(
        'SELECT session_id, pi_session_id, directory_path, session_path FROM external_side_effect_intents LIMIT 1'
      )
      .get()
    const leaseTable = tableExists(database, 'session_run_leases')
      ? 'session_run_leases'
      : tableExists(database, 'workstream_run_leases')
        ? 'workstream_run_leases'
        : undefined
    if (!leaseTable) throw new Error('The application database has no Agent Run lease table.')
    if (schemaVersionNumber >= 5 && !tableExists(database, 'session_repository_locations')) {
      throw new Error('The application database has no Session Repository location table.')
    }
    database.prepare(`SELECT workstream_id, lease_id, session_id, purpose FROM ${leaseTable} LIMIT 1`).get()
    const integrity = database.prepare('PRAGMA integrity_check').get()?.integrity_check
    const generationId = database.prepare("SELECT value FROM metadata WHERE key = 'generation_id'").get()?.value

    return typeof generationId === 'string' && typeof schemaVersion === 'string'
      ? { generationId, schemaVersion: Number(schemaVersion), integrity: integrity === 'ok' ? 'ok' : 'failed' }
      : undefined
  } catch {
    return undefined
  }
}

export async function initializeApplicationStateStore(storageDirectory: string, sqlite: SqliteModule) {
  await ensurePrivateDirectory(storageDirectory)
  const markerPath = join(storageDirectory, markerFileName)
  const databasePath = join(storageDirectory, databaseFileName)
  const [hasMarker, hasDatabase] = await Promise.all([fileExists(markerPath), fileExists(databasePath)])

  await Promise.all([
    hasMarker ? ensurePrivateFile(markerPath) : Promise.resolve(),
    hasDatabase ? ensurePrivateFile(databasePath) : Promise.resolve(),
  ])

  async function createFreshAuthority(): Promise<ApplicationStateStartup> {
    const generationId = randomUUID()
    const database = new sqlite.DatabaseSync(databasePath)
    initializeSchema(database, generationId)
    database.close()
    await ensurePrivateFile(databasePath)
    await writePrivateTextFile(markerPath, `${JSON.stringify({ generationId })}\n`)
    return { status: 'first-launch' }
  }

  let startup: ApplicationStateStartup

  if (!hasMarker && !hasDatabase) {
    startup = await createFreshAuthority()
  } else {
    const marker = await readMarker(markerPath)
    let database: SqliteDatabase | undefined

    try {
      database = hasDatabase ? new sqlite.DatabaseSync(databasePath) : undefined
      const metadata = database ? readMetadata(database) : undefined
      if (
        database &&
        metadata &&
        marker &&
        metadata.integrity === 'ok' &&
        metadata.generationId === marker.generationId &&
        (metadata.schemaVersion === 3 || metadata.schemaVersion === 4 || metadata.schemaVersion === 5)
      ) {
        migrateApplicationState(database)
      }
      startup = classifyApplicationState(marker, database ? readMetadata(database) : undefined)
    } catch {
      startup = { status: 'recovery-only', diagnostic: 'The application database is unreadable.' }
    } finally {
      database?.close()
    }
  }

  if (startup.status !== 'recovery-only') {
    const database = new sqlite.DatabaseSync(databasePath)

    try {
      database.exec('BEGIN IMMEDIATE;')
      const leases = database
        .prepare("SELECT lease_id FROM session_run_leases WHERE purpose IN ('agent-run', 'session-fork')")
        .all()

      if (leases.length > 0) {
        database.prepare("DELETE FROM session_run_leases WHERE purpose IN ('agent-run', 'session-fork')").run()
        incrementRevision(database)
      }

      database.exec('COMMIT;')
    } catch {
      try {
        database.exec('ROLLBACK;')
      } catch {
        // Startup reconciliation failed before a transaction was active.
      }
      startup = { status: 'recovery-only', diagnostic: 'Interrupted Agent Run recovery failed.' }
    } finally {
      database.close()
    }
  }

  async function createBackup(): Promise<string> {
    if (!(await fileExists(databasePath))) {
      throw new Error('No application database is available to back up.')
    }

    const backupPath = join(storageDirectory, `application-state-${Date.now()}.sqlite`)
    const database = new sqlite.DatabaseSync(databasePath)

    try {
      await sqlite.backup(database, backupPath)
      await ensurePrivateFile(backupPath)
      return backupPath
    } finally {
      database.close()
    }
  }

  async function reset(): Promise<ApplicationStateStartup> {
    try {
      await createBackup()
    } catch {
      // Reset remains available when the database itself cannot be copied.
    }

    const retiredDatabasePath = `${databasePath}.${Date.now()}.recovery`
    const retiredMarkerPath = `${markerPath}.${Date.now()}.recovery`

    if (await fileExists(databasePath)) await renameWhenAvailable(databasePath, retiredDatabasePath)
    if (await fileExists(markerPath)) await renameWhenAvailable(markerPath, retiredMarkerPath)

    startup = await createFreshAuthority()
    return startup
  }

  function openDatabase(): SqliteDatabase {
    if (startup.status === 'recovery-only') {
      throw new Error('Application state is in recovery mode.')
    }

    return new sqlite.DatabaseSync(databasePath)
  }

  return {
    get startup() {
      return startup
    },
    createBackup,
    reset,
    openDatabase,
  }
}

export function incrementRevision(database: SqliteDatabase): void {
  database.prepare("UPDATE metadata SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'revision'").run()
}
