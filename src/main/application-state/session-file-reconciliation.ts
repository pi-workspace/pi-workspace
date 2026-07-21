import type { SessionId } from '@/src/domain/session'
import { type PiSessionCreationIntent, type PiSessionFileStore } from '@/src/main/pi-session-files'
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
        `SELECT id, session_id, pi_session_id, directory_path, session_path
           FROM external_side_effect_intents
          WHERE kind = 'create-pi-session-file' AND status = 'pending'
            AND (? IS NULL OR session_id = ?)
          ORDER BY id`
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
        const outcome = await sessionFiles.create(intent)

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
