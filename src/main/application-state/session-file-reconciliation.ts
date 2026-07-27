import type { SessionId } from '@/src/domain/session'
import {
  type PiSessionCreationIntent,
  type PiSessionFileStore,
  type PiSessionForkIntent,
} from '@/src/main/pi-session-files'
import type { SqliteDatabase } from './sqlite'

type SessionFileReconciliationOptions = Readonly<{
  openDatabase: () => SqliteDatabase
  sessionFiles: PiSessionFileStore
  incrementRevision: (database: SqliteDatabase) => void
}>

type SessionCreationStatus = 'available' | 'pending' | 'quarantined'

export function createSessionFileReconciliation({
  openDatabase,
  sessionFiles,
  incrementRevision,
}: SessionFileReconciliationOptions) {
  async function reconcilePendingSessionFiles(
    database: SqliteDatabase,
    targetSessionId?: SessionId
  ): Promise<SessionCreationStatus | undefined> {
    const intents = database
      .prepare(
        `SELECT intent.id, intent.kind, intent.session_id, intent.pi_session_id, intent.directory_path,
                intent.session_path, session.title, session.mode, session.forked_from_entry_id,
                workstream.working_location, parent.expected_jsonl_path AS parent_session_path
           FROM external_side_effect_intents intent
           JOIN sessions session ON session.id = intent.session_id
           JOIN workstreams workstream ON workstream.id = session.workstream_id
           LEFT JOIN sessions parent ON parent.id = session.parent_session_id
          WHERE intent.kind IN ('create-pi-session-file', 'fork-pi-session-file') AND intent.status = 'pending'
            AND (? IS NULL OR intent.session_id = ?)
          ORDER BY intent.id`
      )
      .all(targetSessionId ?? null, targetSessionId ?? null)
    let targetStatus: SessionCreationStatus | undefined

    for (const row of intents) {
      const sessionId = String(row.session_id) as SessionId
      const intent: PiSessionCreationIntent = {
        piSessionId: String(row.pi_session_id),
        directoryPath: String(row.directory_path),
        sessionPath: String(row.session_path),
      }

      try {
        let outcome

        if (row.kind === 'fork-pi-session-file') {
          if (
            typeof row.parent_session_path !== 'string' ||
            typeof row.forked_from_entry_id !== 'string' ||
            typeof row.title !== 'string'
          ) {
            throw new Error('The persisted Session fork intent is malformed.')
          }

          const contextMessage =
            row.mode === 'implement'
              ? 'This is a forked Implement Session. Earlier Session worktree paths in the copied history are reference only. Call workspace_overview and prepare_repository before modifying a Repository in this Session.'
              : row.mode === 'default' && row.working_location === 'worktrees'
                ? 'This is a forked Quick Session with a new dedicated worktree. Earlier working paths in the copied history are reference only.'
                : undefined
          const forkIntent: PiSessionForkIntent = {
            ...intent,
            sourceSessionPath: row.parent_session_path,
            sourceEntryId: row.forked_from_entry_id,
            title: row.title,
            ...(contextMessage ? { contextMessage } : {}),
          }
          outcome = await sessionFiles.fork(forkIntent)
        } else {
          outcome = await sessionFiles.create(intent)
        }

        if (outcome.status === 'available' && !(await sessionFiles.resolve(intent))) {
          throw new Error('The created Pi Session file did not match its persisted intent.')
        }

        database.exec('BEGIN IMMEDIATE;')
        const pendingIntent = database
          .prepare("SELECT session_id FROM external_side_effect_intents WHERE id = ? AND status = 'pending'")
          .get(row.id)

        if (pendingIntent) {
          if (outcome.status === 'quarantined') {
            database
              .prepare("UPDATE sessions SET creation_status = 'quarantined', availability = 'unavailable' WHERE id = ?")
              .run(pendingIntent.session_id)
            database.prepare("UPDATE external_side_effect_intents SET status = 'quarantined' WHERE id = ?").run(row.id)
          } else {
            database
              .prepare("UPDATE sessions SET creation_status = 'finalized', availability = 'available' WHERE id = ?")
              .run(pendingIntent.session_id)
            database.prepare("UPDATE external_side_effect_intents SET status = 'completed' WHERE id = ?").run(row.id)
          }
          incrementRevision(database)
        }

        database.exec('COMMIT;')
        if (sessionId === targetSessionId) targetStatus = outcome.status
      } catch {
        try {
          database.exec('ROLLBACK;')
        } catch {
          // No transaction was active when the external file operation failed.
        }

        if (sessionId === targetSessionId) targetStatus = 'pending'
      }
    }

    return targetStatus
  }

  async function refreshOwnedSessionAvailability(database: SqliteDatabase): Promise<void> {
    const sessions = database
      .prepare(
        `SELECT s.id, s.availability, s.pi_session_id, s.expected_jsonl_path, i.directory_path
           FROM sessions s
           JOIN external_side_effect_intents i ON i.session_id = s.id
          WHERE s.creation_status = 'finalized'`
      )
      .all()

    for (const row of sessions) {
      const resolved = await sessionFiles.resolve({
        piSessionId: String(row.pi_session_id),
        directoryPath: String(row.directory_path),
        sessionPath: String(row.expected_jsonl_path),
      })
      const availability = resolved ? 'available' : 'unavailable'

      if (availability !== row.availability) {
        database.prepare('UPDATE sessions SET availability = ? WHERE id = ?').run(availability, row.id)
      }
    }
  }

  async function reconcileCommittedSession(sessionId: SessionId): Promise<SessionCreationStatus> {
    try {
      const database = openDatabase()

      try {
        return (await reconcilePendingSessionFiles(database, sessionId)) ?? 'pending'
      } finally {
        database.close()
      }
    } catch {
      return 'pending'
    }
  }

  return {
    reconcilePendingSessionFiles,
    refreshOwnedSessionAvailability,
    reconcileCommittedSession,
  }
}
