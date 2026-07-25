import { randomUUID } from 'node:crypto'
import type { SessionId } from '@/src/domain/session'
import type { SqliteDatabase } from './sqlite'

type RunLeaseStoreOptions = Readonly<{
  openDatabase: () => SqliteDatabase
}>

export function createRunLeaseStore({ openDatabase }: RunLeaseStoreOptions) {
  async function acquireSessionRunLease(sessionId: SessionId): Promise<boolean> {
    const database = openDatabase()

    try {
      database.exec('BEGIN IMMEDIATE;')
      const session = database
        .prepare(
          `SELECT session.workstream_id, session.creation_status, workstream.lifecycle
             FROM sessions session
             JOIN workstreams workstream ON workstream.id = session.workstream_id
            WHERE session.id = ?`
        )
        .get(sessionId)

      if (!session || session.creation_status !== 'finalized' || session.lifecycle !== 'active') {
        database.exec('ROLLBACK;')
        return false
      }
      if (database.prepare('SELECT lease_id FROM session_run_leases WHERE session_id = ?').get(sessionId)) {
        database.exec('ROLLBACK;')
        return false
      }
      if (
        database
          .prepare(
            `SELECT 1
               FROM session_run_leases held
               JOIN session_repository_locations held_location
                 ON held_location.session_id = held.session_id
               JOIN session_repository_locations requested_location
                 ON requested_location.session_id = ?
              WHERE held.purpose = 'agent-run'
                AND held.session_id <> ?
                AND held_location.working_path = requested_location.working_path
              LIMIT 1`
          )
          .get(sessionId, sessionId)
      ) {
        database.exec('ROLLBACK;')
        return false
      }

      database
        .prepare(
          `INSERT INTO session_run_leases (workstream_id, lease_id, session_id, purpose, acquired_at)
           VALUES (?, ?, ?, 'agent-run', ?)`
        )
        .run(session.workstream_id, randomUUID(), sessionId, Date.now())
      database.exec('COMMIT;')
      return true
    } catch (error) {
      try {
        database.exec('ROLLBACK;')
      } catch {
        // No transaction remains after a successful commit.
      }
      throw error
    } finally {
      database.close()
    }
  }

  async function settleSessionRunLease(sessionId: SessionId): Promise<boolean> {
    const database = openDatabase()

    try {
      database.exec('BEGIN IMMEDIATE;')
      database.prepare("DELETE FROM session_run_leases WHERE session_id = ? AND purpose = 'agent-run'").run(sessionId)
      database.exec('COMMIT;')
      return true
    } catch (error) {
      database.exec('ROLLBACK;')
      throw error
    } finally {
      database.close()
    }
  }

  return { acquireSessionRunLease, settleSessionRunLease }
}
