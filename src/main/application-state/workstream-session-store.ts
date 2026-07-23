import { randomUUID } from 'node:crypto'
import { createWorkstreamId } from '@/src/main/workstream-id'
import type { ManagedSessionRuntimePolicy } from '@/src/domain/managed-session'
import type { SessionId } from '@/src/domain/session'
import {
  normalizeSessionMode,
  normalizeWorkstreamGoal,
  type CreateQuickSessionOptions,
  type CreateSessionOptions,
  type CreateWorkstreamOptions,
  type ManagedSessionMode,
  type SessionMode,
  type Workstream,
  type WorkstreamLifecycle,
  type WorkstreamWorkingLocation,
  type WorkstreamsSnapshot,
  type WorktreeLocationsPreview,
} from '@/src/domain/workstream'
import {
  inspectWorktree,
  proposeWorktree,
  type InspectedGitRepository,
  type WorktreeProposal,
} from '@/src/main/git-repositories'
import { normalizeSessionTitle } from '@/src/session-title'
import type { OwnedPiSessionLocation, PiSessionCreationIntent, PiSessionFileStore } from '@/src/main/pi-session-files'
import type { SqliteDatabase } from './sqlite'
import {
  initializeStoredWorkstreamKnowledge,
  readCurrentWorkstreamRepositorySet,
  readWorkstreamKnowledge,
} from './workstream-knowledge-store'
import {
  inspectRepositoryAvailability,
  parseStringArray,
  refreshRepositoryAvailability,
  repositoryName,
} from './workspace-repository-store'

type RepositoryInspector = (directoryPath: string) => Promise<InspectedGitRepository>
type SessionCreationStatus = 'available' | 'pending' | 'quarantined'

type WorkstreamSessionStoreOptions = Readonly<{
  openDatabase: () => SqliteDatabase
  inspectRepository: RepositoryInspector
  createWorktree: (proposal: WorktreeProposal) => Promise<WorktreeProposal>
  sessionFiles: PiSessionFileStore
  incrementRevision: (database: SqliteDatabase) => void
  reconcilePendingSessionFiles: (
    database: SqliteDatabase,
    sessionId?: SessionId
  ) => Promise<SessionCreationStatus | undefined>
  refreshOwnedSessionAvailability: (database: SqliteDatabase) => Promise<void>
  reconcileCommittedSession: (sessionId: SessionId) => Promise<SessionCreationStatus>
}>

type WorkstreamProjection = Omit<Workstream, 'repositoryWorkingLocations' | 'sessions'> & {
  repositoryWorkingLocations: Workstream['repositoryWorkingLocations'][number][]
  sessions: Workstream['sessions'][number][]
}

export type OwnedSessionResolution = OwnedPiSessionLocation &
  Readonly<{
    mode: SessionMode
    canSubmit: boolean
    toolAccess: 'none' | 'read-only' | 'full'
    managedPolicy?: ManagedSessionRuntimePolicy
    runtimeKey?: string
  }>

export type WorkstreamCreationResult = Readonly<{
  status: SessionCreationStatus
  sessionId: SessionId
  snapshot: WorkstreamsSnapshot
}>

export function createWorkstreamSessionStore({
  openDatabase,
  inspectRepository,
  createWorktree,
  sessionFiles,
  incrementRevision,
  reconcilePendingSessionFiles,
  refreshOwnedSessionAvailability,
  reconcileCommittedSession,
}: WorkstreamSessionStoreOptions) {
  async function getWorkstreamSnapshot(workspaceId: string, reconcile = true): Promise<WorkstreamsSnapshot> {
    const database = openDatabase()

    try {
      if (reconcile) await reconcilePendingSessionFiles(database)
      await refreshRepositoryAvailability(database, inspectRepository, incrementRevision)
      await refreshOwnedSessionAvailability(database)
      const workspace = database.prepare('SELECT id FROM workspaces WHERE id = ?').get(workspaceId)

      if (!workspace) throw new TypeError('The Workspace no longer exists.')

      const rows = database
        .prepare(
          `SELECT w.id AS workstream_id, w.goal, w.lifecycle, w.working_location, s.id AS session_id, s.title, s.mode,
                s.availability, s.access_kind, s.repository_id,
                r.directory_path AS repository_directory_path, r.availability AS repository_availability
           FROM workstreams w
           LEFT JOIN sessions s ON s.workstream_id = w.id
           LEFT JOIN repositories r ON r.id = s.repository_id
          WHERE w.workspace_id = ?
          ORDER BY w.created_at, w.rowid, s.created_at, s.rowid`
        )
        .all(workspaceId)
      const workstreams = new Map<string, WorkstreamProjection>()

      for (const row of rows) {
        const workstreamId = String(row.workstream_id)
        let workstream = workstreams.get(workstreamId)

        if (!workstream) {
          try {
            workstream = {
              id: workstreamId,
              workspaceId,
              goal: typeof row.goal === 'string' ? row.goal : undefined,
              lifecycle: parseWorkstreamLifecycle(row.lifecycle),
              workingLocation: parseWorkstreamWorkingLocation(row.working_location),
              repositoryWorkingLocations: [],
              sessions: [],
            }
          } catch (error) {
            workstream = unavailableWorkstream(workstreamId, workspaceId, row.goal, error)
          }

          workstreams.set(workstreamId, workstream)
        }

        if (workstream.unavailability || typeof row.session_id !== 'string') continue

        try {
          const sessionProperties = {
            id: row.session_id as SessionId,
            workstreamId,
            title: String(row.title),
            availability: parseSessionAvailability(row.availability),
          }

          if (row.mode === 'default') {
            if (
              row.access_kind !== 'direct' ||
              typeof row.repository_id !== 'string' ||
              typeof row.repository_directory_path !== 'string'
            ) {
              throw new Error('A Default Session must have direct Repository access.')
            }

            workstream.sessions.push({
              ...sessionProperties,
              mode: 'default',
              repositoryAccess: {
                kind: 'direct',
                repositoryId: row.repository_id,
                repositoryName: repositoryName(row.repository_directory_path),
                availability: parseSessionAvailability(row.repository_availability),
              },
            })
          } else {
            if ((row.mode !== 'brainstorm' && row.mode !== 'implement') || row.access_kind !== 'managed') {
              throw new Error('A Brainstorm or Implement Session must have managed Repository access.')
            }

            workstream.sessions.push({
              ...sessionProperties,
              mode: row.mode,
              repositoryAccess: { kind: 'managed' },
            })
          }
        } catch (error) {
          workstream = unavailableWorkstream(workstreamId, workspaceId, row.goal, error)
          workstreams.set(workstreamId, workstream)
        }
      }

      for (const [workstreamId, workstream] of workstreams) {
        if (!workstream.goal || workstream.unavailability) continue

        try {
          readWorkstreamKnowledge(database, workstreamId)
        } catch (error) {
          workstreams.set(workstreamId, unavailableWorkstream(workstreamId, workspaceId, workstream.goal, error))
        }
      }

      const workingLocations = database
        .prepare(
          `SELECT workstream_id, repository_id, kind, working_path, branch, location_availability,
                directory_path, common_directory_path, repository_availability
           FROM (
             SELECT workstream.id AS workstream_id, repository.id AS repository_id,
                    'current-checkout' AS kind, repository.directory_path AS working_path,
                    NULL AS branch, repository.availability AS location_availability,
                    repository.directory_path, repository.common_directory_path,
                    repository.availability AS repository_availability,
                    workstream.created_at AS workstream_created_at, membership.rowid AS location_order
               FROM workstreams workstream
               JOIN workspace_repositories membership ON membership.workspace_id = workstream.workspace_id
               JOIN repositories repository ON repository.id = membership.repository_id
              WHERE workstream.workspace_id = ?
                AND workstream.working_location = 'current-checkouts'
                AND (
                  workstream.goal IS NOT NULL
                  OR repository.id = (
                    SELECT session.repository_id
                      FROM sessions session
                     WHERE session.workstream_id = workstream.id AND session.access_kind = 'direct'
                     LIMIT 1
                  )
                )
             UNION ALL
             SELECT workstream.id AS workstream_id, repository.id AS repository_id,
                    location.kind, location.working_path, location.branch,
                    location.availability AS location_availability,
                    repository.directory_path, repository.common_directory_path,
                    repository.availability AS repository_availability,
                    workstream.created_at AS workstream_created_at, location.rowid AS location_order
               FROM workstream_repository_locations location
               JOIN workstreams workstream ON workstream.id = location.workstream_id
               JOIN repositories repository ON repository.id = location.repository_id
              WHERE workstream.workspace_id = ? AND workstream.working_location = 'worktrees'
           )
          ORDER BY workstream_created_at, location_order`
        )
        .all(workspaceId, workspaceId)

      for (const location of workingLocations) {
        const workstream = workstreams.get(String(location.workstream_id))
        if (!workstream || workstream.unavailability) continue

        try {
          const kind = parseWorkstreamRepositoryLocationKind(location.kind)
          const repositoryAvailability = parseSessionAvailability(location.repository_availability)
          let availability = repositoryAvailability

          if (kind === 'worktree') {
            const observedAvailability =
              typeof location.branch === 'string'
                ? await inspectWorktree({
                    worktreePath: String(location.working_path),
                    commonDirectoryPath: String(location.common_directory_path),
                  })
                : 'unavailable'
            availability =
              repositoryAvailability === 'available' && observedAvailability === 'available'
                ? 'available'
                : 'unavailable'

            if (availability !== location.location_availability) {
              database
                .prepare(
                  'UPDATE workstream_repository_locations SET availability = ? WHERE workstream_id = ? AND repository_id = ?'
                )
                .run(availability, location.workstream_id, location.repository_id)
              database
                .prepare(
                  'UPDATE workstreams SET working_location_revision = working_location_revision + 1 WHERE id = ?'
                )
                .run(location.workstream_id)
              incrementRevision(database)
            }
          }

          workstream.repositoryWorkingLocations.push({
            repositoryId: String(location.repository_id),
            repositoryName: repositoryName(String(location.directory_path)),
            kind,
            ...(availability === 'available'
              ? { availability, workingPath: String(location.working_path) }
              : { availability }),
          })
        } catch (error) {
          workstreams.set(workstream.id, unavailableWorkstream(workstream.id, workspaceId, workstream.goal, error))
        }
      }

      for (const workstream of workstreams.values()) {
        if (workstream.goal || workstream.unavailability) continue

        workstream.sessions = workstream.sessions.map((session) => {
          if (session.mode !== 'default') return session

          const recordedLocation = workstream.repositoryWorkingLocations.find(
            (location) => location.repositoryId === session.repositoryAccess.repositoryId
          )

          return recordedLocation
            ? {
                ...session,
                repositoryAccess: {
                  ...session.repositoryAccess,
                  availability: recordedLocation.availability,
                },
              }
            : session
        })
      }

      const revision = Number(database.prepare("SELECT value FROM metadata WHERE key = 'revision'").get()?.value ?? 0)

      return { revision, workstreams: [...workstreams.values()] }
    } finally {
      database.close()
    }
  }

  function insertOwnedSession(
    database: SqliteDatabase,
    workstreamId: string,
    options: Readonly<
      { title?: string } & (
        { mode: 'default'; repositoryId: string } | { mode: ManagedSessionMode; repositoryId?: never }
      )
    >
  ): SessionId {
    const sessionId = randomUUID() as SessionId
    const piSessionId = randomUUID()
    const intentId = randomUUID()
    const intent = sessionFiles.intent(piSessionId)

    database
      .prepare(
        `INSERT INTO sessions
        (id, workstream_id, title, mode, availability, access_kind, repository_id, pi_session_id, expected_jsonl_path, creation_status, created_at)
       VALUES (?, ?, ?, ?, 'unavailable', ?, ?, ?, ?, 'pending', ?)`
      )
      .run(
        sessionId,
        workstreamId,
        normalizeSessionTitle(options.title ?? '') ?? 'New Session',
        options.mode,
        options.mode === 'default' ? 'direct' : 'managed',
        options.mode === 'default' ? options.repositoryId : null,
        piSessionId,
        intent.sessionPath,
        Date.now()
      )
    database
      .prepare(
        `INSERT INTO external_side_effect_intents
        (id, kind, status, session_id, pi_session_id, directory_path, session_path)
       VALUES (?, 'create-pi-session-file', 'pending', ?, ?, ?, ?)`
      )
      .run(intentId, sessionId, intent.piSessionId, intent.directoryPath, intent.sessionPath)

    return sessionId
  }

  function insertSessionWorkingLocationsFromWorkstream(
    database: SqliteDatabase,
    sessionId: SessionId,
    workstreamId: string,
    repositoryId?: string
  ): void {
    database
      .prepare(
        `INSERT INTO session_repository_locations
          (session_id, repository_id, kind, working_path, branch, base_commit, availability)
         SELECT ?, repository_id, kind, working_path, branch, base_commit, availability
           FROM workstream_repository_locations
          WHERE workstream_id = ? AND (? IS NULL OR repository_id = ?)
         ON CONFLICT (session_id, repository_id) DO NOTHING`
      )
      .run(sessionId, workstreamId, repositoryId ?? null, repositoryId ?? null)
  }

  const sessionLocationPreparations = new Map<SessionId, Promise<void>>()

  async function prepareDedicatedSessionWorktrees(sessionId: SessionId): Promise<void> {
    const ongoing = sessionLocationPreparations.get(sessionId)
    if (ongoing) return ongoing

    const preparation = prepareDedicatedSessionWorktreesNow(sessionId)
    sessionLocationPreparations.set(sessionId, preparation)

    try {
      await preparation
    } finally {
      if (sessionLocationPreparations.get(sessionId) === preparation) sessionLocationPreparations.delete(sessionId)
    }
  }

  async function prepareDedicatedSessionWorktreesNow(sessionId: SessionId): Promise<void> {
    const sessionDatabase = openDatabase()
    let session: Readonly<{ workstreamId: string; workspaceId: string }> | undefined

    try {
      const row = sessionDatabase
        .prepare(
          `SELECT session.workstream_id, workstream.workspace_id
             FROM sessions session
             JOIN workstreams workstream ON workstream.id = session.workstream_id
            WHERE session.id = ?
              AND session.access_kind = 'managed'
              AND session.mode IN ('brainstorm', 'implement')
              AND workstream.lifecycle = 'active'`
        )
        .get(sessionId)
      session = row ? { workstreamId: String(row.workstream_id), workspaceId: String(row.workspace_id) } : undefined
    } finally {
      sessionDatabase.close()
    }

    if (!session) return

    const repositoryDatabase = openDatabase()
    let repositories: readonly Readonly<{ id: string; directoryPath: string }>[]

    try {
      repositories = repositoryDatabase
        .prepare(
          `SELECT repository.id, repository.directory_path
             FROM workspace_repositories membership
             JOIN repositories repository ON repository.id = membership.repository_id
            WHERE membership.workspace_id = ? AND repository.availability = 'available'
            ORDER BY membership.rowid`
        )
        .all(session.workspaceId)
        .map((row) => ({ id: String(row.id), directoryPath: String(row.directory_path) }))
    } finally {
      repositoryDatabase.close()
    }

    for (const repository of repositories) {
      await prepareDedicatedSessionRepositoryWorktree(sessionId, session.workstreamId, repository)
    }
  }

  async function prepareDedicatedSessionRepositoryWorktree(
    sessionId: SessionId,
    workstreamId: string,
    repository: Readonly<{ id: string; directoryPath: string }>
  ): Promise<void> {
    const existing = openDatabase()

    try {
      const location = existing
        .prepare('SELECT 1 FROM session_repository_locations WHERE session_id = ? AND repository_id = ?')
        .get(sessionId, repository.id)
      if (location) return
    } finally {
      existing.close()
    }

    let proposal: WorktreeProposal

    try {
      proposal = await proposeWorktree({
        repositoryId: repository.id,
        repositoryPath: repository.directoryPath,
        workstreamId: sessionId,
      })
    } catch {
      const fallback = openDatabase()
      try {
        fallback.exec('BEGIN IMMEDIATE;')
        fallback
          .prepare(
            `INSERT INTO session_repository_locations
              (session_id, repository_id, kind, working_path, availability)
             VALUES (?, ?, 'current-checkout', ?, 'available')
             ON CONFLICT (session_id, repository_id) DO NOTHING`
          )
          .run(sessionId, repository.id, repository.directoryPath)
        fallback.exec('COMMIT;')
      } catch {
        try {
          fallback.exec('ROLLBACK;')
        } catch {
          // The transaction may already have rolled back.
        }
      } finally {
        fallback.close()
      }
      return
    }

    const recorded = openDatabase()
    try {
      recorded.exec('BEGIN IMMEDIATE;')
      recorded
        .prepare(
          `INSERT INTO session_repository_locations
            (session_id, repository_id, kind, working_path, branch, base_commit, availability)
           VALUES (?, ?, 'worktree', ?, ?, ?, 'unavailable')
           ON CONFLICT (session_id, repository_id) DO NOTHING`
        )
        .run(sessionId, repository.id, proposal.worktreePath, proposal.branch, proposal.baseCommit)
      recorded.exec('COMMIT;')
    } catch {
      try {
        recorded.exec('ROLLBACK;')
      } catch {
        // The transaction may already have rolled back.
      }
      return
    } finally {
      recorded.close()
    }

    let available: boolean

    try {
      const exists =
        (await inspectWorktree({
          worktreePath: proposal.worktreePath,
          commonDirectoryPath: proposal.commonDirectoryPath,
          expectedBranch: proposal.branch,
        })) === 'available'
      if (!exists) await createWorktree(proposal)
      available = true
    } catch {
      available = false
    }

    const updated = openDatabase()
    try {
      updated.exec('BEGIN IMMEDIATE;')
      updated
        .prepare('UPDATE session_repository_locations SET availability = ? WHERE session_id = ? AND repository_id = ?')
        .run(available ? 'available' : 'unavailable', sessionId, repository.id)
      updated
        .prepare('UPDATE workstreams SET working_location_revision = working_location_revision + 1 WHERE id = ?')
        .run(workstreamId)
      incrementRevision(updated)
      updated.exec('COMMIT;')
    } catch {
      try {
        updated.exec('ROLLBACK;')
      } catch {
        // The transaction may already have rolled back.
      }
    } finally {
      updated.close()
    }
  }

  async function previewWorktreeProposal(
    workspaceId: string,
    workstreamId: string,
    repositoryId?: string
  ): Promise<readonly WorktreeProposal[]> {
    const database = openDatabase()

    try {
      await refreshRepositoryAvailability(database, inspectRepository, incrementRevision)
      if (!database.prepare('SELECT id FROM workspaces WHERE id = ?').get(workspaceId)) {
        throw new TypeError('The Workspace no longer exists.')
      }
      const repositories = database
        .prepare(
          `SELECT repository.id, repository.directory_path
           FROM workspace_repositories membership
           JOIN repositories repository ON repository.id = membership.repository_id
          WHERE membership.workspace_id = ?
            AND repository.availability = 'available'
            AND (? IS NULL OR repository.id = ?)
          ORDER BY membership.rowid`
        )
        .all(workspaceId, repositoryId ?? null, repositoryId ?? null)

      if (repositoryId && repositories.length === 0) {
        throw new TypeError('Select an available Repository from the current Workspace.')
      }

      return Promise.all(
        repositories.map((repository) =>
          proposeWorktree({
            repositoryId: String(repository.id),
            repositoryPath: String(repository.directory_path),
            workstreamId,
          })
        )
      )
    } finally {
      database.close()
    }
  }

  async function previewWorktreeLocations(
    workspaceId: string,
    repositoryId?: string
  ): Promise<WorktreeLocationsPreview> {
    const workstreamId = createWorkstreamId()
    const proposals = await previewWorktreeProposal(workspaceId, workstreamId, repositoryId)

    return {
      workstreamId,
      repositories: proposals.map((proposal) => ({
        repositoryId: proposal.repositoryId,
        repositoryName: repositoryName(proposal.sourcePath),
        workingPath: proposal.worktreePath,
        branch: proposal.branch,
        baseCommit: proposal.baseCommit,
      })),
    }
  }

  function insertCurrentCheckoutLocations(database: SqliteDatabase, workspaceId: string, workstreamId: string): void {
    database
      .prepare(
        `INSERT INTO workstream_repository_locations
        (workstream_id, repository_id, kind, working_path, availability)
       SELECT ?, repository.id, 'current-checkout', repository.directory_path, repository.availability
         FROM workspace_repositories membership
         JOIN repositories repository ON repository.id = membership.repository_id
        WHERE membership.workspace_id = ?`
      )
      .run(workstreamId, workspaceId)
  }

  async function prepareWorktreeBackedWorkstream(
    workspaceId: string,
    workstreamId: string,
    goal: string | null,
    repositoryId?: string
  ): Promise<void> {
    const proposals = await previewWorktreeProposal(workspaceId, workstreamId, repositoryId)
    const database = openDatabase()
    let resumingCreation = false

    try {
      database.exec('BEGIN IMMEDIATE;')
      const existing = database
        .prepare(
          `SELECT workstream.workspace_id, workstream.goal, workstream.working_location,
                COUNT(session.id) AS session_count
           FROM workstreams workstream
           LEFT JOIN sessions session ON session.workstream_id = workstream.id
          WHERE workstream.id = ?
          GROUP BY workstream.id`
        )
        .get(workstreamId)

      if (existing) {
        const recordedLocations = database
          .prepare(
            `SELECT repository_id, working_path, branch
             FROM workstream_repository_locations
            WHERE workstream_id = ?
            ORDER BY rowid`
          )
          .all(workstreamId)
        const previewMatches =
          recordedLocations.length === proposals.length &&
          proposals.every((proposal, index) => {
            const recorded = recordedLocations[index]

            return (
              recorded?.repository_id === proposal.repositoryId &&
              recorded.working_path === proposal.worktreePath &&
              recorded.branch === proposal.branch
            )
          })

        if (
          existing.workspace_id !== workspaceId ||
          existing.goal !== goal ||
          existing.working_location !== 'worktrees' ||
          Number(existing.session_count) > 0 ||
          !previewMatches
        ) {
          throw new TypeError('The worktree preview can no longer be used.')
        }

        resumingCreation = true
      } else {
        database
          .prepare(
            "INSERT INTO workstreams (id, workspace_id, goal, lifecycle, working_location, created_at) VALUES (?, ?, ?, 'active', 'worktrees', ?)"
          )
          .run(workstreamId, workspaceId, goal, Date.now())
        if (goal !== null) initializeStoredWorkstreamKnowledge(database, workstreamId)
        for (const proposal of proposals) {
          database
            .prepare(
              `INSERT INTO workstream_repository_locations
              (workstream_id, repository_id, kind, working_path, branch, base_commit, availability)
             VALUES (?, ?, 'worktree', ?, ?, ?, 'unavailable')`
            )
            .run(workstreamId, proposal.repositoryId, proposal.worktreePath, proposal.branch, proposal.baseCommit)
        }
        incrementRevision(database)
      }
      database.exec('COMMIT;')
    } catch (error) {
      try {
        database.exec('ROLLBACK;')
      } catch {
        // The transaction may already have rolled back.
      }
      throw error
    } finally {
      database.close()
    }

    for (const proposal of proposals) {
      const recorded = openDatabase()
      const location = recorded
        .prepare(
          'SELECT availability FROM workstream_repository_locations WHERE workstream_id = ? AND repository_id = ?'
        )
        .get(workstreamId, proposal.repositoryId)
      recorded.close()

      if (location?.availability === 'available') continue

      const observedAvailability = resumingCreation
        ? await inspectWorktree({
            worktreePath: proposal.worktreePath,
            commonDirectoryPath: proposal.commonDirectoryPath,
            expectedBranch: proposal.branch,
          })
        : 'unavailable'

      if (observedAvailability !== 'available') await createWorktree(proposal)

      const observed = openDatabase()
      try {
        observed.exec('BEGIN IMMEDIATE;')
        observed
          .prepare(
            "UPDATE workstream_repository_locations SET availability = 'available' WHERE workstream_id = ? AND repository_id = ?"
          )
          .run(workstreamId, proposal.repositoryId)
        observed
          .prepare('UPDATE workstreams SET working_location_revision = working_location_revision + 1 WHERE id = ?')
          .run(workstreamId)
        incrementRevision(observed)
        observed.exec('COMMIT;')
      } catch (error) {
        observed.exec('ROLLBACK;')
        throw error
      } finally {
        observed.close()
      }
    }
  }

  async function createWorkstream(
    workspaceId: string,
    options: CreateWorkstreamOptions
  ): Promise<WorkstreamCreationResult> {
    const goal = normalizeWorkstreamGoal(options.goal)
    const workingLocation = options.workingLocation ?? 'current-checkouts'

    if (workingLocation === 'worktrees') {
      if (
        !options.workstreamId ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-7][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(options.workstreamId)
      ) {
        throw new TypeError('Preview the Workstream worktree locations before creation.')
      }

      await prepareWorktreeBackedWorkstream(workspaceId, options.workstreamId, goal)

      const finalized = openDatabase()
      let sessionId: SessionId
      try {
        finalized.exec('BEGIN IMMEDIATE;')
        sessionId = insertOwnedSession(finalized, options.workstreamId, { mode: normalizeSessionMode(options.mode) })
        insertSessionWorkingLocationsFromWorkstream(finalized, sessionId, options.workstreamId)
        incrementRevision(finalized)
        finalized.exec('COMMIT;')
      } catch (error) {
        try {
          finalized.exec('ROLLBACK;')
        } catch {
          // The transaction may already have rolled back.
        }
        throw error
      } finally {
        finalized.close()
      }

      const status = await reconcileCommittedSession(sessionId)
      return { status, sessionId, snapshot: await getWorkstreamSnapshot(workspaceId, false) }
    }

    const database = openDatabase()
    let sessionId: SessionId

    try {
      database.exec('BEGIN IMMEDIATE;')
      if (!database.prepare('SELECT id FROM workspaces WHERE id = ?').get(workspaceId)) {
        throw new TypeError('The Workspace no longer exists.')
      }

      const workstreamId = options.workstreamId ?? createWorkstreamId()
      if (
        options.workstreamId &&
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-7][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(options.workstreamId)
      ) {
        throw new TypeError('The Workstream worktree preview can no longer be used.')
      }

      const failedWorktreeCreation = database
        .prepare(
          `SELECT workstream.workspace_id, workstream.goal, workstream.working_location,
                COUNT(session.id) AS session_count,
                SUM(CASE WHEN location.availability = 'available' THEN 1 ELSE 0 END) AS available_location_count
           FROM workstreams workstream
           LEFT JOIN sessions session ON session.workstream_id = workstream.id
           LEFT JOIN workstream_repository_locations location ON location.workstream_id = workstream.id
          WHERE workstream.id = ?
          GROUP BY workstream.id`
        )
        .get(workstreamId)

      if (failedWorktreeCreation) {
        if (
          failedWorktreeCreation.workspace_id !== workspaceId ||
          failedWorktreeCreation.goal !== goal ||
          failedWorktreeCreation.working_location !== 'worktrees' ||
          Number(failedWorktreeCreation.session_count) > 0 ||
          Number(failedWorktreeCreation.available_location_count) > 0
        ) {
          throw new TypeError('Retry Workstream worktree creation before using current checkouts.')
        }

        database.prepare('DELETE FROM workstream_repository_locations WHERE workstream_id = ?').run(workstreamId)
        database.prepare('DELETE FROM workstream_knowledge WHERE workstream_id = ?').run(workstreamId)
        database.prepare('DELETE FROM workstreams WHERE id = ?').run(workstreamId)
      }

      database
        .prepare(
          "INSERT INTO workstreams (id, workspace_id, goal, lifecycle, working_location, created_at) VALUES (?, ?, ?, 'active', 'current-checkouts', ?)"
        )
        .run(workstreamId, workspaceId, goal, Date.now())
      initializeStoredWorkstreamKnowledge(database, workstreamId)
      insertCurrentCheckoutLocations(database, workspaceId, workstreamId)
      sessionId = insertOwnedSession(database, workstreamId, { mode: normalizeSessionMode(options.mode) })
      insertSessionWorkingLocationsFromWorkstream(database, sessionId, workstreamId)
      incrementRevision(database)
      database.exec('COMMIT;')
    } catch (error) {
      try {
        database.exec('ROLLBACK;')
      } catch {
        // The durable creation intent may already have committed.
      }
      throw error
    } finally {
      database.close()
    }

    const status = await reconcileCommittedSession(sessionId)

    return { status, sessionId, snapshot: await getWorkstreamSnapshot(workspaceId, false) }
  }

  async function createQuickSession(
    workspaceId: string,
    options: CreateQuickSessionOptions
  ): Promise<WorkstreamCreationResult> {
    const workingLocation = options.workingLocation ?? 'current-checkouts'
    const workstreamId = options.workstreamId ?? createWorkstreamId()

    if (
      options.workstreamId &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-7][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(options.workstreamId)
    ) {
      throw new TypeError('The Quick Session worktree preview can no longer be used.')
    }

    if (workingLocation === 'worktrees') {
      if (
        !options.workstreamId ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-7][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(options.workstreamId)
      ) {
        throw new TypeError('Preview the Quick Session worktree location before creation.')
      }

      await prepareWorktreeBackedWorkstream(workspaceId, workstreamId, null, options.repositoryId)
    }

    const database = openDatabase()
    let sessionId: SessionId

    try {
      await refreshRepositoryAvailability(database, inspectRepository, incrementRevision)
      database.exec('BEGIN IMMEDIATE;')
      const repository = database
        .prepare(
          `SELECT r.id, r.availability
           FROM workspace_repositories m
           JOIN repositories r ON r.id = m.repository_id
          WHERE m.workspace_id = ? AND r.id = ?`
        )
        .get(workspaceId, options.repositoryId)

      if (!repository) throw new TypeError('Select a Repository from the current Workspace.')
      if (repository.availability !== 'available') throw new TypeError('The selected Repository is unavailable.')

      if (workingLocation === 'current-checkouts') {
        const failedWorktreeCreation = database
          .prepare(
            `SELECT workstream.workspace_id, workstream.goal, workstream.working_location,
                  COUNT(session.id) AS session_count,
                  SUM(CASE WHEN location.availability = 'available' THEN 1 ELSE 0 END) AS available_location_count,
                  MIN(location.repository_id) AS repository_id
             FROM workstreams workstream
             LEFT JOIN sessions session ON session.workstream_id = workstream.id
             LEFT JOIN workstream_repository_locations location ON location.workstream_id = workstream.id
            WHERE workstream.id = ?
            GROUP BY workstream.id`
          )
          .get(workstreamId)

        if (failedWorktreeCreation) {
          if (
            failedWorktreeCreation.workspace_id !== workspaceId ||
            failedWorktreeCreation.goal !== null ||
            failedWorktreeCreation.working_location !== 'worktrees' ||
            Number(failedWorktreeCreation.session_count) > 0 ||
            Number(failedWorktreeCreation.available_location_count) > 0 ||
            failedWorktreeCreation.repository_id !== options.repositoryId
          ) {
            throw new TypeError('Retry Quick Session worktree creation before using the current checkout.')
          }

          database.prepare('DELETE FROM workstream_repository_locations WHERE workstream_id = ?').run(workstreamId)
          database.prepare('DELETE FROM workstreams WHERE id = ?').run(workstreamId)
        }

        database
          .prepare(
            "INSERT INTO workstreams (id, workspace_id, goal, lifecycle, working_location, created_at) VALUES (?, ?, NULL, 'active', 'current-checkouts', ?)"
          )
          .run(workstreamId, workspaceId, Date.now())
      }
      sessionId = insertOwnedSession(database, workstreamId, {
        mode: 'default',
        title: 'Quick Session',
        repositoryId: options.repositoryId,
      })
      insertSessionWorkingLocationsFromWorkstream(database, sessionId, workstreamId, options.repositoryId)
      incrementRevision(database)
      database.exec('COMMIT;')
    } catch (error) {
      try {
        database.exec('ROLLBACK;')
      } catch {
        // The durable creation intent may already have committed.
      }
      throw error
    } finally {
      database.close()
    }

    const status = await reconcileCommittedSession(sessionId)

    return { status, sessionId, snapshot: await getWorkstreamSnapshot(workspaceId, false) }
  }

  async function createWorkstreamSession(
    workstreamId: string,
    options: CreateSessionOptions
  ): Promise<WorkstreamCreationResult> {
    const database = openDatabase()
    let sessionId: SessionId
    let workspaceId: string

    try {
      database.exec('BEGIN IMMEDIATE;')
      const workstream = database
        .prepare('SELECT workspace_id, goal, lifecycle FROM workstreams WHERE id = ?')
        .get(workstreamId)

      if (!workstream) throw new TypeError('The Workstream no longer exists.')
      if (workstream.lifecycle !== 'active') throw new TypeError('An archived Workstream cannot create Sessions.')
      if (typeof workstream.goal !== 'string') {
        throw new TypeError('Set a Workstream goal before creating a Brainstorm or Implement Session.')
      }

      workspaceId = String(workstream.workspace_id)
      sessionId = insertOwnedSession(database, workstreamId, options)
      incrementRevision(database)
      database.exec('COMMIT;')
    } catch (error) {
      try {
        database.exec('ROLLBACK;')
      } catch {
        // The durable creation intent may already have committed.
      }
      throw error
    } finally {
      database.close()
    }

    await prepareDedicatedSessionWorktrees(sessionId)
    const status = await reconcileCommittedSession(sessionId)

    return { status, sessionId, snapshot: await getWorkstreamSnapshot(workspaceId, false) }
  }

  async function setWorkstreamLifecycle(
    workstreamId: string,
    lifecycle: WorkstreamLifecycle
  ): Promise<WorkstreamsSnapshot> {
    const database = openDatabase()
    let workspaceId: string

    try {
      database.exec('BEGIN IMMEDIATE;')
      const workstream = database
        .prepare('SELECT workspace_id, lifecycle FROM workstreams WHERE id = ?')
        .get(workstreamId)

      if (!workstream) throw new TypeError('The Workstream no longer exists.')
      parseWorkstreamLifecycle(workstream.lifecycle)
      workspaceId = String(workstream.workspace_id)

      if (workstream.lifecycle === lifecycle) {
        database.exec('COMMIT;')
      } else {
        if (
          lifecycle === 'archived' &&
          database.prepare('SELECT lease_id FROM session_run_leases WHERE workstream_id = ?').get(workstreamId)
        ) {
          throw new TypeError('A Workstream can be archived only while every Session is idle.')
        }

        database.prepare('UPDATE workstreams SET lifecycle = ? WHERE id = ?').run(lifecycle, workstreamId)
        incrementRevision(database)
        database.exec('COMMIT;')
      }
    } catch (error) {
      database.exec('ROLLBACK;')
      throw error
    } finally {
      database.close()
    }

    return getWorkstreamSnapshot(workspaceId)
  }

  async function renameWorkstreamSession(sessionId: SessionId, title: string): Promise<WorkstreamsSnapshot> {
    const normalizedTitle = normalizeSessionTitle(title)

    if (!normalizedTitle) throw new TypeError('A Session title is required.')

    const database = openDatabase()
    let workspaceId: string

    try {
      database.exec('BEGIN IMMEDIATE;')
      const session = database
        .prepare(
          `SELECT w.workspace_id
           FROM sessions s
           JOIN workstreams w ON w.id = s.workstream_id
          WHERE s.id = ?`
        )
        .get(sessionId)

      if (!session) throw new TypeError('The Session no longer exists.')

      workspaceId = String(session.workspace_id)
      database.prepare('UPDATE sessions SET title = ? WHERE id = ?').run(normalizedTitle, sessionId)
      incrementRevision(database)
      database.exec('COMMIT;')
    } catch (error) {
      database.exec('ROLLBACK;')
      throw error
    } finally {
      database.close()
    }

    return getWorkstreamSnapshot(workspaceId)
  }

  async function resolveOwnedSession(sessionId: SessionId): Promise<OwnedSessionResolution | undefined> {
    await prepareDedicatedSessionWorktrees(sessionId)
    const database = openDatabase()

    try {
      await reconcilePendingSessionFiles(database)
      const row = database
        .prepare(
          `SELECT s.id, s.mode, s.access_kind, s.creation_status, s.pi_session_id,
                s.expected_jsonl_path, w.id AS workstream_id, w.workspace_id, w.goal, w.lifecycle,
                w.working_location, w.working_location_revision, ws.metadata_revision, i.directory_path, s.repository_id,
                r.directory_path AS repository_directory_path,
                r.common_directory_path AS repository_common_directory_path,
                direct_location.working_path AS direct_working_path,
                direct_location.branch AS direct_working_branch,
                direct_location.availability AS direct_working_availability
           FROM sessions s
           JOIN workstreams w ON w.id = s.workstream_id
           JOIN workspaces ws ON ws.id = w.workspace_id
           JOIN external_side_effect_intents i ON i.session_id = s.id
           LEFT JOIN repositories r ON r.id = s.repository_id
           LEFT JOIN workstream_repository_locations direct_location
             ON direct_location.workstream_id = w.id AND direct_location.repository_id = s.repository_id
          WHERE s.id = ?`
        )
        .get(sessionId)

      if (!row || row.creation_status !== 'finalized') return undefined
      if (row.mode !== 'default' && row.mode !== 'brainstorm' && row.mode !== 'implement') {
        throw new Error('The Session has an unsupported mode.')
      }
      if ((row.mode === 'default') !== (row.access_kind === 'direct')) {
        throw new Error('The Session mode does not match its Repository access.')
      }

      try {
        parseWorkstreamLifecycle(row.lifecycle)
        parseWorkstreamWorkingLocation(row.working_location)
        if (typeof row.goal === 'string') readWorkstreamKnowledge(database, String(row.workstream_id))
      } catch {
        return undefined
      }

      const intent: PiSessionCreationIntent = {
        piSessionId: String(row.pi_session_id),
        directoryPath: String(row.directory_path),
        sessionPath: String(row.expected_jsonl_path),
      }
      const location = await sessionFiles.resolve(intent)

      const sourceRepositoryAvailable =
        row.access_kind !== 'direct' ||
        (await inspectRepositoryAvailability(
          String(row.repository_directory_path),
          String(row.repository_common_directory_path),
          inspectRepository
        )) === 'available'
      const directWorktreeAvailable =
        row.access_kind !== 'direct' ||
        row.working_location !== 'worktrees' ||
        (typeof row.direct_working_path === 'string' &&
          typeof row.direct_working_branch === 'string' &&
          (await inspectWorktree({
            worktreePath: row.direct_working_path,
            commonDirectoryPath: String(row.repository_common_directory_path),
          })) === 'available')
      const repositoryAvailable = sourceRepositoryAvailable && directWorktreeAvailable

      if (row.access_kind === 'direct' && row.working_location === 'current-checkouts') {
        database
          .prepare('UPDATE repositories SET availability = ? WHERE id = ?')
          .run(repositoryAvailable ? 'available' : 'unavailable', row.repository_id)
      } else if (
        row.access_kind === 'direct' &&
        row.working_location === 'worktrees' &&
        row.direct_working_availability !== (repositoryAvailable ? 'available' : 'unavailable')
      ) {
        database
          .prepare(
            'UPDATE workstream_repository_locations SET availability = ? WHERE workstream_id = ? AND repository_id = ?'
          )
          .run(repositoryAvailable ? 'available' : 'unavailable', row.workstream_id, row.repository_id)
        database
          .prepare('UPDATE workstreams SET working_location_revision = working_location_revision + 1 WHERE id = ?')
          .run(row.workstream_id)
        incrementRevision(database)
      }

      database
        .prepare('UPDATE sessions SET availability = ? WHERE id = ?')
        .run(location ? 'available' : 'unavailable', sessionId)

      if (!location || !repositoryAvailable) return undefined
      const mode: SessionMode = row.mode
      const canSubmit = row.lifecycle === 'active'
      const toolAccess = canSubmit ? 'full' : 'none'
      let managedPolicy: ManagedSessionRuntimePolicy | undefined

      if (row.access_kind === 'managed' && (mode === 'brainstorm' || mode === 'implement')) {
        try {
          let workingLocationRevision = Number(row.working_location_revision)
          const repositoryRows = database
            .prepare(
              `SELECT repository.id, repository.directory_path, repository.common_directory_path,
                  repository.availability, membership.id AS membership_id, membership.role, membership.relationships,
                  location.kind AS location_kind, location.working_path, location.branch,
                  location.availability AS location_availability
             FROM workspace_repositories membership
             JOIN repositories repository ON repository.id = membership.repository_id
             LEFT JOIN session_repository_locations location
               ON location.session_id = ? AND location.repository_id = repository.id
            WHERE membership.workspace_id = ?
            ORDER BY membership.rowid`
            )
            .all(sessionId, row.workspace_id)
          const repositoryIdByMembershipId = new Map(
            repositoryRows.map((repository) => [String(repository.membership_id), String(repository.id)])
          )
          const repositories = await Promise.all(
            repositoryRows.map(async (repository) => {
              const repositoryAvailability = parseSessionAvailability(repository.availability)
              const locationKind =
                repository.location_kind === undefined || repository.location_kind === null
                  ? undefined
                  : parseWorkstreamRepositoryLocationKind(repository.location_kind)
              const workingPath = repository.working_path
              let locationAvailability =
                repository.location_availability === undefined || repository.location_availability === null
                  ? 'unavailable'
                  : parseSessionAvailability(repository.location_availability)

              if (
                locationKind === 'worktree' &&
                typeof repository.working_path === 'string' &&
                typeof repository.branch === 'string'
              ) {
                const observedAvailability = await inspectWorktree({
                  worktreePath: repository.working_path,
                  commonDirectoryPath: String(repository.common_directory_path),
                })

                if (observedAvailability !== locationAvailability) {
                  locationAvailability = observedAvailability
                  database
                    .prepare(
                      'UPDATE session_repository_locations SET availability = ? WHERE session_id = ? AND repository_id = ?'
                    )
                    .run(locationAvailability, sessionId, repository.id)
                  database
                    .prepare(
                      'UPDATE workstreams SET working_location_revision = working_location_revision + 1 WHERE id = ?'
                    )
                    .run(row.workstream_id)
                  workingLocationRevision += 1
                  incrementRevision(database)
                }
              }

              const availability =
                repositoryAvailability === 'available' && locationAvailability === 'available'
                  ? 'available'
                  : 'unavailable'
              const properties = {
                id: String(repository.id),
                name: repositoryName(String(repository.directory_path)),
                commonDirectoryPath: String(repository.common_directory_path),
                role: String(repository.role),
                relationships: parseStringArray(repository.relationships).flatMap((relationship) => {
                  const repositoryId = repositoryIdByMembershipId.get(relationship)

                  return repositoryId ? [repositoryId] : []
                }),
              }

              return availability === 'available' && typeof workingPath === 'string'
                ? { ...properties, availability: 'available' as const, workingPath }
                : { ...properties, availability: 'unavailable' as const }
            })
          )
          const lease = database.prepare('SELECT lease_id FROM session_run_leases WHERE session_id = ?').get(sessionId)

          managedPolicy = {
            workspaceId: String(row.workspace_id),
            workstreamId: String(row.workstream_id),
            sessionId,
            mode,
            lifecycle: parseWorkstreamLifecycle(row.lifecycle),
            runLeaseId: typeof lease?.lease_id === 'string' ? lease.lease_id : undefined,
            repositories,
            piSessionPath: location.sessionPath,
            resourcePolicyRevision: Number(row.metadata_revision) + workingLocationRevision,
          }
        } catch {
          return undefined
        }
      }

      return {
        directoryPath:
          row.access_kind === 'direct'
            ? row.working_location === 'worktrees'
              ? String(row.direct_working_path)
              : String(row.repository_directory_path)
            : location.directoryPath,
        sessionPath: location.sessionPath,
        mode,
        canSubmit,
        toolAccess,
        managedPolicy,
        runtimeKey: managedPolicy
          ? `managed:${managedPolicy.lifecycle}:${managedPolicy.resourcePolicyRevision}:${managedPolicy.runLeaseId ?? 'idle'}`
          : 'default',
      }
    } finally {
      database.close()
    }
  }

  async function resolveWorkstreamWorkingLocation(workstreamId: string, repositoryId: string): Promise<string> {
    const database = openDatabase()
    let workspaceId: string

    try {
      const workstream = database.prepare('SELECT workspace_id FROM workstreams WHERE id = ?').get(workstreamId)
      if (!workstream) throw new TypeError('The Workstream no longer exists.')

      workspaceId = String(workstream.workspace_id)
    } finally {
      database.close()
    }

    const snapshot = await getWorkstreamSnapshot(workspaceId)
    const location = snapshot.workstreams
      .find((workstream) => workstream.id === workstreamId)
      ?.repositoryWorkingLocations.find((candidate) => candidate.repositoryId === repositoryId)

    if (!location || location.availability !== 'available') {
      throw new TypeError('The recorded working location is unavailable.')
    }

    return location.workingPath
  }

  async function getCurrentWorkstreamRepositorySet(workstreamId: string): Promise<readonly string[]> {
    const database = openDatabase()

    try {
      return readCurrentWorkstreamRepositorySet(database, workstreamId)
    } finally {
      database.close()
    }
  }
  return {
    getWorkstreamSnapshot,
    previewWorktreeLocations,
    createWorkstream,
    createQuickSession,
    createWorkstreamSession,
    setWorkstreamLifecycle,
    renameWorkstreamSession,
    resolveOwnedSession,
    resolveWorkstreamWorkingLocation,
    getCurrentWorkstreamRepositorySet,
  }
}

function unavailableWorkstream(
  workstreamId: string,
  workspaceId: string,
  goal: unknown,
  error: unknown
): WorkstreamProjection {
  return {
    id: workstreamId,
    workspaceId,
    goal: typeof goal === 'string' ? goal : undefined,
    lifecycle: 'archived',
    workingLocation: 'current-checkouts',
    repositoryWorkingLocations: [],
    sessions: [],
    unavailability: error instanceof Error ? error.message : 'The persisted Workstream is malformed.',
  }
}

function parseWorkstreamLifecycle(value: unknown): WorkstreamLifecycle {
  if (value === 'active' || value === 'archived') return value

  throw new Error('The persisted Workstream lifecycle is malformed.')
}

function parseWorkstreamWorkingLocation(value: unknown): WorkstreamWorkingLocation {
  if (value === 'current-checkouts' || value === 'worktrees') return value

  throw new Error('The persisted Workstream working location is malformed.')
}

function parseWorkstreamRepositoryLocationKind(value: unknown): 'current-checkout' | 'worktree' {
  if (value === 'current-checkout' || value === 'worktree') return value

  throw new Error('The persisted Workstream working location is malformed.')
}

function parseSessionAvailability(value: unknown): 'available' | 'unavailable' {
  if (value === 'available' || value === 'unavailable') return value

  throw new Error('The persisted Session availability is malformed.')
}
