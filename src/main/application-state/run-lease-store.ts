import { randomUUID } from 'node:crypto'
import type { SessionId } from '@/src/domain/session'
import type { SqliteDatabase } from './sqlite'

type RunLeaseStoreOptions = Readonly<{
  openDatabase: () => SqliteDatabase
}>

type SessionLeasePurpose = 'agent-run' | 'branch-switch' | 'context-compaction' | 'worktree-creation'

export function createRunLeaseStore({ openDatabase }: RunLeaseStoreOptions) {
  async function acquireSessionLease(sessionId: SessionId, purpose: SessionLeasePurpose): Promise<boolean> {
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
        (purpose === 'agent-run' || purpose === 'branch-switch') &&
        database
          .prepare(
            `WITH effective_locations AS (
               SELECT session.id AS session_id, location.working_path
                 FROM sessions session
                 JOIN session_repository_locations location ON location.session_id = session.id
                WHERE session.access_kind = 'direct'
               UNION
               SELECT session.id AS session_id,
                      CASE
                        WHEN location.kind = 'worktree' AND location.availability = 'available'
                          THEN location.working_path
                        ELSE repository.directory_path
                      END AS working_path
                 FROM sessions session
                 JOIN workstreams workstream ON workstream.id = session.workstream_id
                 JOIN workstream_repositories selected ON selected.workstream_id = workstream.id
                 JOIN workspace_repositories membership
                   ON membership.workspace_id = workstream.workspace_id AND membership.repository_id = selected.repository_id
                 JOIN repositories repository ON repository.id = membership.repository_id
                 LEFT JOIN session_repository_locations location
                   ON location.session_id = session.id AND location.repository_id = repository.id
                WHERE session.access_kind = 'managed'
                  AND repository.availability = 'available'
             )
             SELECT 1
               FROM session_run_leases held
               JOIN effective_locations held_location ON held_location.session_id = held.session_id
               JOIN effective_locations requested_location ON requested_location.session_id = ?
              WHERE held.purpose IN ('agent-run', 'branch-switch')
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
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(session.workstream_id, randomUUID(), sessionId, purpose, Date.now())
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

  async function settleSessionLease(sessionId: SessionId, purpose: SessionLeasePurpose): Promise<boolean> {
    const database = openDatabase()

    try {
      database.exec('BEGIN IMMEDIATE;')
      database.prepare('DELETE FROM session_run_leases WHERE session_id = ? AND purpose = ?').run(sessionId, purpose)
      database.exec('COMMIT;')
      return true
    } catch (error) {
      database.exec('ROLLBACK;')
      throw error
    } finally {
      database.close()
    }
  }

  return {
    acquireSessionRunLease: (sessionId: SessionId) => acquireSessionLease(sessionId, 'agent-run'),
    settleSessionRunLease: (sessionId: SessionId) => settleSessionLease(sessionId, 'agent-run'),
    acquireSessionCompactionLease: (sessionId: SessionId) => acquireSessionLease(sessionId, 'context-compaction'),
    settleSessionCompactionLease: (sessionId: SessionId) => settleSessionLease(sessionId, 'context-compaction'),
    acquireSessionWorktreeLease: (sessionId: SessionId) => acquireSessionLease(sessionId, 'worktree-creation'),
    settleSessionWorktreeLease: (sessionId: SessionId) => settleSessionLease(sessionId, 'worktree-creation'),
    acquireSessionBranchSwitchLease: (sessionId: SessionId) => acquireSessionLease(sessionId, 'branch-switch'),
    settleSessionBranchSwitchLease: (sessionId: SessionId) => settleSessionLease(sessionId, 'branch-switch'),
  }
}
