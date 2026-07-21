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

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
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
    CREATE TABLE sessions (id TEXT PRIMARY KEY, workstream_id TEXT NOT NULL REFERENCES workstreams(id), title TEXT NOT NULL, mode TEXT NOT NULL, availability TEXT NOT NULL, access_kind TEXT NOT NULL, repository_id TEXT REFERENCES repositories(id), pi_session_id TEXT NOT NULL UNIQUE, expected_jsonl_path TEXT NOT NULL UNIQUE, creation_status TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE workstream_repository_locations (workstream_id TEXT NOT NULL REFERENCES workstreams(id), repository_id TEXT NOT NULL REFERENCES repositories(id), kind TEXT NOT NULL, working_path TEXT NOT NULL, branch TEXT, base_commit TEXT, availability TEXT NOT NULL, PRIMARY KEY (workstream_id, repository_id));
    CREATE TABLE workstream_run_leases (workstream_id TEXT PRIMARY KEY REFERENCES workstreams(id), lease_id TEXT NOT NULL UNIQUE, session_id TEXT NOT NULL REFERENCES sessions(id), purpose TEXT NOT NULL, acquired_at INTEGER NOT NULL);
    CREATE TABLE external_side_effect_intents (id TEXT PRIMARY KEY, kind TEXT NOT NULL, status TEXT NOT NULL, session_id TEXT NOT NULL REFERENCES sessions(id), pi_session_id TEXT NOT NULL, directory_path TEXT NOT NULL, session_path TEXT NOT NULL);
    ${workstreamKnowledgeSchemaSql}
    INSERT INTO metadata (key, value) VALUES ('generation_id', '${generationId}'), ('schema_version', '${applicationStateSchemaVersion}'), ('revision', '0');
    COMMIT;
  `)
}

function readMetadata(database: SqliteDatabase): ApplicationStateMetadata | undefined {
  try {
    database.exec('PRAGMA foreign_keys = ON;')
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
        'SELECT mode, availability, access_kind, repository_id, pi_session_id, expected_jsonl_path, creation_status, created_at FROM sessions LIMIT 1'
      )
      .get()
    database
      .prepare(
        'SELECT session_id, pi_session_id, directory_path, session_path FROM external_side_effect_intents LIMIT 1'
      )
      .get()
    database.prepare('SELECT workstream_id, lease_id, session_id, purpose FROM workstream_run_leases LIMIT 1').get()
    const integrity = database.prepare('PRAGMA integrity_check').get()?.integrity_check
    const generationId = database.prepare("SELECT value FROM metadata WHERE key = 'generation_id'").get()?.value
    const schemaVersion = database.prepare("SELECT value FROM metadata WHERE key = 'schema_version'").get()?.value

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
      const leases = database.prepare("SELECT lease_id FROM workstream_run_leases WHERE purpose = 'agent-run'").all()

      if (leases.length > 0) {
        database.prepare("DELETE FROM workstream_run_leases WHERE purpose = 'agent-run'").run()
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

    if (await fileExists(databasePath)) await rename(databasePath, retiredDatabasePath)
    if (await fileExists(markerPath)) await rename(markerPath, retiredMarkerPath)

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
