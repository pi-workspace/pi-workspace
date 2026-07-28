import { randomUUID } from 'node:crypto'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import { createWorkstreamId } from '@/src/main/workstream-id'
import type { ManagedSessionRuntimePolicy } from '@/src/domain/managed-session'
import type { SessionId } from '@/src/domain/session'
import {
  normalizeWorkstreamGoal,
  type CreateQuickSessionOptions,
  type CreateSessionOptions,
  type CreateWorkstreamOptions,
  type ForkSessionOptions,
  type SessionForkPoint,
  type Workstream,
  type WorkstreamLifecycle,
  type WorkstreamWorkingLocation,
  type WorkstreamsSnapshot,
  type WorktreeLocationsPreview,
} from '@/src/domain/workstream'
import {
  inspectWorktree,
  proposeWorktree,
  type GitBranchReference,
  type InspectedGitRepository,
  type WorktreeProposal,
} from '@/src/main/git-repositories'
import { restorePiUserMessageDraft } from '@/src/main/pi-session-message-mapping'
import { normalizeSessionDescription } from '@/src/session-description'
import { normalizeSessionTitle } from '@/src/session-title'
import type { OwnedPiSessionLocation, PiSessionCreationIntent, PiSessionFileStore } from '@/src/main/pi-session-files'
import type {
  SessionRepositoryBranchesSnapshot,
  SessionWorkingLocationsSnapshot,
} from '@/src/session-working-locations'
import type { SqliteDatabase } from './sqlite'
import { initializeStoredWorkstreamKnowledge, readCurrentWorkstreamRepositorySet } from './workstream-knowledge-store'
import {
  inspectRepositoryAvailability,
  parseStringArray,
  refreshRepositoryAvailability,
  repositoryName,
} from './workspace-repository-store'

type RepositoryInspector = (directoryPath: string) => Promise<InspectedGitRepository>
type BranchInspector = (directoryPath: string) => Promise<string>
type BranchLister = (directoryPath: string) => Promise<readonly GitBranchReference[]>
type BranchSwitcher = (directoryPath: string, branch: GitBranchReference) => Promise<string>
type SessionCreationStatus = 'available' | 'pending' | 'quarantined'

type WorkstreamSessionStoreOptions = Readonly<{
  openDatabase: () => SqliteDatabase
  inspectRepository: RepositoryInspector
  inspectBranch: BranchInspector
  listBranches: BranchLister
  fetchBranches: BranchLister
  switchBranch: BranchSwitcher
  createWorktree: (proposal: WorktreeProposal) => Promise<WorktreeProposal>
  restoreWorktree: (proposal: WorktreeProposal) => Promise<WorktreeProposal>
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

export type SessionForkResult = WorkstreamCreationResult & Readonly<{ draft: string }>

export type PreparedSessionRepository = Readonly<{
  repositoryId: string
  workingPath: string
  resourcePolicyRevision: number
}>

export type SessionChangeRepositoryLocation = Readonly<{
  repositoryId: string
  repositoryName: string
  workingPath: string
}>

export function createWorkstreamSessionStore({
  openDatabase,
  inspectRepository,
  inspectBranch,
  listBranches,
  fetchBranches,
  switchBranch,
  createWorktree,
  restoreWorktree,
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
          `SELECT w.id AS workstream_id, w.goal, w.lifecycle, w.working_location, s.id AS session_id, s.title,
                s.description, s.mode, s.availability, s.access_kind, s.repository_id,
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
            ...(typeof row.description === 'string' ? { description: row.description } : {}),
            availability: parseSessionAvailability(row.availability),
          }

          if (row.access_kind === 'direct') {
            if (typeof row.repository_id !== 'string' || typeof row.repository_directory_path !== 'string') {
              throw new Error('A Quick Session must have direct Repository access.')
            }

            workstream.sessions.push({
              ...sessionProperties,
              repositoryAccess: {
                kind: 'direct',
                repositoryId: row.repository_id,
                repositoryName: repositoryName(row.repository_directory_path),
                availability: parseSessionAvailability(row.repository_availability),
              },
            })
          } else {
            if (row.access_kind !== 'managed') {
              throw new Error('A Workstream Session must have managed Repository access.')
            }

            workstream.sessions.push({
              ...sessionProperties,
              repositoryAccess: { kind: 'managed' },
            })
          }
        } catch (error) {
          workstream = unavailableWorkstream(workstreamId, workspaceId, row.goal, error)
          workstreams.set(workstreamId, workstream)
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
               LEFT JOIN workstream_repositories selected
                 ON selected.workstream_id = workstream.id AND selected.repository_id = repository.id
              WHERE workstream.workspace_id = ?
                AND workstream.working_location = 'current-checkouts'
                AND (
                  (workstream.goal IS NOT NULL AND selected.repository_id IS NOT NULL)
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
          const repositoryAccess = session.repositoryAccess
          if (repositoryAccess.kind !== 'direct') return session

          const recordedLocation = workstream.repositoryWorkingLocations.find(
            (location) => location.repositoryId === repositoryAccess.repositoryId
          )

          return recordedLocation
            ? {
                ...session,
                repositoryAccess: {
                  ...repositoryAccess,
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
      { title?: string; fork?: Readonly<{ parentSessionId: SessionId; entryId: string }> } & (
        { access: 'direct'; repositoryId: string } | { access: 'managed'; repositoryId?: never }
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
        (id, workstream_id, title, mode, availability, access_kind, repository_id, pi_session_id,
         expected_jsonl_path, creation_status, created_at, parent_session_id, forked_from_entry_id)
       VALUES (?, ?, ?, ?, 'unavailable', ?, ?, ?, ?, 'pending', ?, ?, ?)`
      )
      .run(
        sessionId,
        workstreamId,
        normalizeSessionTitle(options.title ?? '') ?? 'New Session',
        options.access === 'direct' ? 'default' : 'managed',
        options.access,
        options.access === 'direct' ? options.repositoryId : null,
        piSessionId,
        intent.sessionPath,
        Date.now(),
        options.fork?.parentSessionId ?? null,
        options.fork?.entryId ?? null
      )
    database
      .prepare(
        `INSERT INTO external_side_effect_intents
        (id, kind, status, session_id, pi_session_id, directory_path, session_path)
       VALUES (?, ?, 'pending', ?, ?, ?, ?)`
      )
      .run(
        intentId,
        options.fork ? 'fork-pi-session-file' : 'create-pi-session-file',
        sessionId,
        intent.piSessionId,
        intent.directoryPath,
        intent.sessionPath
      )

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

  function insertCurrentCheckoutSessionLocation(
    database: SqliteDatabase,
    sessionId: SessionId,
    repositoryId: string
  ): void {
    database
      .prepare(
        `INSERT INTO session_repository_locations
          (session_id, repository_id, kind, working_path, availability)
         SELECT ?, id, 'current-checkout', directory_path, availability
           FROM repositories
          WHERE id = ?`
      )
      .run(sessionId, repositoryId)
  }

  async function previewWorktreeProposal(
    workspaceId: string,
    workstreamId: string,
    repositoryId: string,
    sourcePath?: string
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
            AND repository.id = ?
          ORDER BY membership.rowid`
        )
        .all(workspaceId, repositoryId)

      if (repositories.length === 0) {
        throw new TypeError('Select an available Repository from the current Workspace.')
      }

      return Promise.all(
        repositories.map((repository) =>
          proposeWorktree({
            repositoryId: String(repository.id),
            repositoryPath: sourcePath ?? String(repository.directory_path),
            worktreeId: workstreamId,
          })
        )
      )
    } finally {
      database.close()
    }
  }

  async function previewWorktreeLocations(
    workspaceId: string,
    repositoryId: string
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

  async function prepareWorktreeBackedQuickSession(
    workspaceId: string,
    workstreamId: string,
    repositoryId: string,
    sourcePath?: string
  ): Promise<void> {
    const proposals = await previewWorktreeProposal(workspaceId, workstreamId, repositoryId, sourcePath)
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
          existing.goal !== null ||
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
            "INSERT INTO workstreams (id, workspace_id, goal, lifecycle, working_location, created_at) VALUES (?, ?, NULL, 'active', 'worktrees', ?)"
          )
          .run(workstreamId, workspaceId, Date.now())
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
    const database = openDatabase()
    let sessionId: SessionId

    try {
      database.exec('BEGIN IMMEDIATE;')
      if (!database.prepare('SELECT id FROM workspaces WHERE id = ?').get(workspaceId)) {
        throw new TypeError('The Workspace no longer exists.')
      }

      const workspaceRepositories = database
        .prepare(
          `SELECT repository_id
             FROM workspace_repositories
            WHERE workspace_id = ?
            ORDER BY rowid`
        )
        .all(workspaceId)
        .map((row) => String(row.repository_id))
      const repositoryIds = [...new Set(options.repositoryIds ?? workspaceRepositories)]

      if (repositoryIds.length === 0) throw new TypeError('Select at least one Repository for the Workstream.')
      if (repositoryIds.some((repositoryId) => !workspaceRepositories.includes(repositoryId))) {
        throw new TypeError('Select Repositories from the current Workspace.')
      }

      const workstreamId = createWorkstreamId()
      database
        .prepare(
          "INSERT INTO workstreams (id, workspace_id, goal, lifecycle, working_location, created_at) VALUES (?, ?, ?, 'active', 'current-checkouts', ?)"
        )
        .run(workstreamId, workspaceId, goal, Date.now())
      const insertRepository = database.prepare(
        'INSERT INTO workstream_repositories (workstream_id, repository_id) VALUES (?, ?)'
      )
      for (const repositoryId of repositoryIds) insertRepository.run(workstreamId, repositoryId)
      initializeStoredWorkstreamKnowledge(database, workstreamId)
      sessionId = insertOwnedSession(database, workstreamId, { access: 'managed' })
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

      await prepareWorktreeBackedQuickSession(workspaceId, workstreamId, options.repositoryId)
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
        access: 'direct',
        title: 'Quick Session',
        repositoryId: options.repositoryId,
      })
      if (workingLocation === 'current-checkouts') {
        insertCurrentCheckoutSessionLocation(database, sessionId, options.repositoryId)
      } else {
        insertSessionWorkingLocationsFromWorkstream(database, sessionId, workstreamId, options.repositoryId)
      }
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

  function incrementSessionWorkingLocationRevision(database: SqliteDatabase, sessionId: SessionId): void {
    database
      .prepare(
        `UPDATE workstreams
            SET working_location_revision = working_location_revision + 1
          WHERE id = (SELECT workstream_id FROM sessions WHERE id = ?)`
      )
      .run(sessionId)
  }

  function readSessionResourcePolicyRevision(database: SqliteDatabase, sessionId: SessionId): number {
    const revision = database
      .prepare(
        `SELECT workspace.metadata_revision + workstream.working_location_revision AS revision
           FROM sessions session
           JOIN workstreams workstream ON workstream.id = session.workstream_id
           JOIN workspaces workspace ON workspace.id = workstream.workspace_id
          WHERE session.id = ?`
      )
      .get(sessionId)?.revision

    if (typeof revision !== 'number') throw new Error('The Session resource policy is unavailable.')

    return revision
  }

  async function createSessionWorktree(sessionId: SessionId, repositoryId: string): Promise<PreparedSessionRepository> {
    const database = openDatabase()
    let proposal: WorktreeProposal | undefined
    let reusesPersistedWorktree: boolean

    try {
      await refreshRepositoryAvailability(database, inspectRepository, incrementRevision)
      const repository = database
        .prepare(
          `SELECT repository.directory_path, repository.availability
             FROM sessions session
             JOIN workstreams workstream ON workstream.id = session.workstream_id
             JOIN workstream_repositories selected ON selected.workstream_id = workstream.id
             JOIN workspace_repositories membership
               ON membership.workspace_id = workstream.workspace_id AND membership.repository_id = selected.repository_id
             JOIN repositories repository
               ON repository.id = membership.repository_id AND repository.id = ?
            WHERE session.id = ?
              AND session.access_kind = 'managed'
              AND workstream.lifecycle = 'active'`
        )
        .get(repositoryId, sessionId)

      if (!repository) throw new TypeError('Select a Repository from the Workstream.')
      if (repository.availability !== 'available') throw new TypeError('The selected Repository is unavailable.')

      const existing = database
        .prepare('SELECT kind FROM session_repository_locations WHERE session_id = ? AND repository_id = ?')
        .get(sessionId, repositoryId)
      reusesPersistedWorktree = existing?.kind === 'worktree'
      if (!reusesPersistedWorktree) {
        if (existing && existing.kind !== 'current-checkout') {
          throw new Error('The persisted Session working location is malformed.')
        }

        proposal = await proposeWorktree({
          repositoryId,
          repositoryPath: String(repository.directory_path),
          worktreeId: sessionId,
        })
        database
          .prepare(
            `INSERT INTO session_repository_locations
              (session_id, repository_id, kind, working_path, branch, base_commit, availability)
             VALUES (?, ?, 'worktree', ?, ?, ?, 'unavailable')
             ON CONFLICT (session_id, repository_id) DO UPDATE SET
               kind = excluded.kind,
               working_path = excluded.working_path,
               branch = excluded.branch,
               base_commit = excluded.base_commit,
               availability = excluded.availability`
          )
          .run(sessionId, repositoryId, proposal.worktreePath, proposal.branch, proposal.baseCommit)
        incrementRevision(database)
      }
    } finally {
      database.close()
    }

    if (reusesPersistedWorktree) return prepareSessionRepository(sessionId, repositoryId)
    if (!proposal) throw new Error('The Session worktree proposal is unavailable.')

    await createWorktree(proposal)

    const prepared = openDatabase()
    let resourcePolicyRevision: number
    try {
      prepared.exec('BEGIN IMMEDIATE;')
      prepared
        .prepare(
          "UPDATE session_repository_locations SET availability = 'available' WHERE session_id = ? AND repository_id = ?"
        )
        .run(sessionId, repositoryId)
      incrementSessionWorkingLocationRevision(prepared, sessionId)
      incrementRevision(prepared)
      resourcePolicyRevision = readSessionResourcePolicyRevision(prepared, sessionId)
      prepared.exec('COMMIT;')
    } catch (error) {
      prepared.exec('ROLLBACK;')
      throw error
    } finally {
      prepared.close()
    }

    return { repositoryId, workingPath: proposal.worktreePath, resourcePolicyRevision }
  }

  async function prepareSessionRepository(
    sessionId: SessionId,
    repositoryId: string
  ): Promise<PreparedSessionRepository> {
    const database = openDatabase()
    let proposal: WorktreeProposal

    try {
      await refreshRepositoryAvailability(database, inspectRepository, incrementRevision)
      const repository = database
        .prepare(
          `SELECT repository.directory_path, repository.common_directory_path, repository.availability
             FROM sessions session
             JOIN workstreams workstream ON workstream.id = session.workstream_id
             JOIN workstream_repositories selected ON selected.workstream_id = workstream.id
             JOIN workspace_repositories membership
               ON membership.workspace_id = workstream.workspace_id AND membership.repository_id = selected.repository_id
             JOIN repositories repository
               ON repository.id = membership.repository_id AND repository.id = ?
            WHERE session.id = ?
              AND session.access_kind = 'managed'
              AND workstream.lifecycle = 'active'`
        )
        .get(repositoryId, sessionId)

      if (!repository) throw new TypeError('Select a Repository from the Workstream.')
      if (repository.availability !== 'available') throw new TypeError('The selected Repository is unavailable.')

      const existing = database
        .prepare(
          `SELECT kind, working_path, branch, base_commit, availability
             FROM session_repository_locations
            WHERE session_id = ? AND repository_id = ?`
        )
        .get(sessionId, repositoryId)

      if (existing && existing.kind !== 'current-checkout' && existing.kind !== 'worktree') {
        throw new Error('The persisted Session working location is malformed.')
      }
      if (
        existing?.kind === 'worktree' &&
        (typeof existing.working_path !== 'string' ||
          typeof existing.branch !== 'string' ||
          typeof existing.base_commit !== 'string')
      ) {
        throw new Error('The persisted Session worktree is malformed.')
      }

      if (existing?.kind !== 'worktree') {
        if (
          !existing ||
          existing.working_path !== repository.directory_path ||
          existing.availability !== repository.availability
        ) {
          database
            .prepare(
              `INSERT INTO session_repository_locations
                (session_id, repository_id, kind, working_path, branch, base_commit, availability)
               VALUES (?, ?, 'current-checkout', ?, NULL, NULL, 'available')
               ON CONFLICT (session_id, repository_id) DO UPDATE SET
                 kind = excluded.kind,
                 working_path = excluded.working_path,
                 branch = NULL,
                 base_commit = NULL,
                 availability = excluded.availability`
            )
            .run(sessionId, repositoryId, repository.directory_path)
          incrementRevision(database)
        }

        return {
          repositoryId,
          workingPath: String(repository.directory_path),
          resourcePolicyRevision: readSessionResourcePolicyRevision(database, sessionId),
        }
      }

      const persistedWorktree = {
        workingPath: String(existing.working_path),
        branch: String(existing.branch),
        baseCommit: String(existing.base_commit),
      }
      const observedAvailability = await inspectWorktree({
        worktreePath: persistedWorktree.workingPath,
        commonDirectoryPath: String(repository.common_directory_path),
        expectedBranch: persistedWorktree.branch,
      })

      if (observedAvailability === 'available') {
        if (existing.availability !== 'available') {
          database
            .prepare(
              "UPDATE session_repository_locations SET availability = 'available' WHERE session_id = ? AND repository_id = ?"
            )
            .run(sessionId, repositoryId)
          incrementSessionWorkingLocationRevision(database, sessionId)
          incrementRevision(database)
        }

        return {
          repositoryId,
          workingPath: persistedWorktree.workingPath,
          resourcePolicyRevision: readSessionResourcePolicyRevision(database, sessionId),
        }
      }

      proposal = {
        repositoryId,
        sourcePath: String(repository.directory_path),
        commonDirectoryPath: String(repository.common_directory_path),
        worktreePath: persistedWorktree.workingPath,
        branch: persistedWorktree.branch,
        baseCommit: persistedWorktree.baseCommit,
      }
    } finally {
      database.close()
    }

    await restoreWorktree(proposal)

    const prepared = openDatabase()
    let resourcePolicyRevision: number
    try {
      prepared.exec('BEGIN IMMEDIATE;')
      prepared
        .prepare(
          "UPDATE session_repository_locations SET availability = 'available' WHERE session_id = ? AND repository_id = ?"
        )
        .run(sessionId, repositoryId)
      incrementSessionWorkingLocationRevision(prepared, sessionId)
      incrementRevision(prepared)
      resourcePolicyRevision = readSessionResourcePolicyRevision(prepared, sessionId)
      prepared.exec('COMMIT;')
    } catch (error) {
      prepared.exec('ROLLBACK;')
      throw error
    } finally {
      prepared.close()
    }

    return { repositoryId, workingPath: proposal.worktreePath, resourcePolicyRevision }
  }

  async function getSessionForkPoints(sessionId: SessionId): Promise<readonly SessionForkPoint[]> {
    const resolution = await resolveOwnedSession(sessionId)
    if (!resolution) throw new TypeError('The Session is unavailable.')

    const manager = SessionManager.open(resolution.sessionPath, undefined, resolution.directoryPath)
    const messages = manager.getBranch().flatMap((entry) => {
      if (entry.type !== 'message' || entry.message.role !== 'user') return []

      const text = restorePiUserMessageDraft(userMessageText(entry.message.content))
      return text ? [{ entryId: entry.id, text }] : []
    })

    return messages.map((message, index) => ({
      ...message,
      position: index + 1,
      total: messages.length,
    }))
  }

  async function forkSession(sessionId: SessionId, options: ForkSessionOptions): Promise<SessionForkResult> {
    const title = normalizeSessionTitle(options.title)
    if (!title) throw new TypeError('A Session title is required.')

    const forkPoint = (await getSessionForkPoints(sessionId)).find((point) => point.entryId === options.entryId)
    if (!forkPoint) throw new TypeError('Select a user message from the current Session history.')
    const sourceResolution = await resolveOwnedSession(sessionId)
    if (!sourceResolution) throw new TypeError('The Session is unavailable.')

    const leaseId = randomUUID()
    let sourceWorkstreamId: string
    let sourceAccessKind: 'direct' | 'managed'
    let sourceRepositoryId: string | undefined
    let sourceWorkingLocation: WorkstreamWorkingLocation
    let workspaceId: string
    const authority = openDatabase()

    try {
      authority.exec('BEGIN IMMEDIATE;')
      const source = authority
        .prepare(
          `SELECT session.workstream_id, session.access_kind, session.repository_id, session.creation_status,
                  session.availability, workstream.workspace_id, workstream.goal, workstream.lifecycle,
                  workstream.working_location
             FROM sessions session
             JOIN workstreams workstream ON workstream.id = session.workstream_id
            WHERE session.id = ?`
        )
        .get(sessionId)

      if (
        !source ||
        source.creation_status !== 'finalized' ||
        source.availability !== 'available' ||
        source.lifecycle !== 'active'
      ) {
        throw new TypeError('The Session must be available and active before it can be forked.')
      }
      if (source.access_kind !== 'direct' && source.access_kind !== 'managed') {
        throw new TypeError('This Session Repository access cannot be forked.')
      }
      if (source.access_kind === 'direct' && (source.goal !== null || typeof source.repository_id !== 'string')) {
        throw new TypeError('The Quick Session ownership is malformed.')
      }
      if (source.access_kind === 'managed' && typeof source.goal !== 'string') {
        throw new TypeError('The Session must belong to a goal-based Workstream.')
      }
      if (source.working_location !== 'current-checkouts' && source.working_location !== 'worktrees') {
        throw new TypeError('The Session working location is malformed.')
      }
      if (authority.prepare('SELECT 1 FROM session_run_leases WHERE session_id = ?').get(sessionId)) {
        throw new TypeError('Wait for the Session to become idle before forking it.')
      }

      sourceWorkstreamId = String(source.workstream_id)
      sourceAccessKind = source.access_kind
      sourceRepositoryId = typeof source.repository_id === 'string' ? source.repository_id : undefined
      sourceWorkingLocation = source.working_location
      workspaceId = String(source.workspace_id)
      authority
        .prepare(
          `INSERT INTO session_run_leases (workstream_id, lease_id, session_id, purpose, acquired_at)
           VALUES (?, ?, ?, 'session-fork', ?)`
        )
        .run(sourceWorkstreamId, leaseId, sessionId, Date.now())
      authority.exec('COMMIT;')
    } catch (error) {
      try {
        authority.exec('ROLLBACK;')
      } catch {
        // No transaction remains after a successful commit.
      }
      throw error
    } finally {
      authority.close()
    }

    try {
      let targetWorkstreamId = sourceWorkstreamId

      if (sourceAccessKind === 'direct') {
        if (!sourceRepositoryId) throw new TypeError('The Quick Session Repository is unavailable.')

        targetWorkstreamId = createWorkstreamId()
        if (sourceWorkingLocation === 'worktrees') {
          await prepareWorktreeBackedQuickSession(
            workspaceId,
            targetWorkstreamId,
            sourceRepositoryId,
            sourceResolution.directoryPath
          )
        }
      }

      const creation = openDatabase()
      let targetSessionId: SessionId

      try {
        creation.exec('BEGIN IMMEDIATE;')
        const lease = creation
          .prepare("SELECT lease_id FROM session_run_leases WHERE session_id = ? AND purpose = 'session-fork'")
          .get(sessionId)
        if (lease?.lease_id !== leaseId) throw new TypeError('The Session fork authority expired.')

        if (sourceAccessKind === 'direct' && sourceWorkingLocation === 'current-checkouts') {
          creation
            .prepare(
              "INSERT INTO workstreams (id, workspace_id, goal, lifecycle, working_location, created_at) VALUES (?, ?, NULL, 'active', 'current-checkouts', ?)"
            )
            .run(targetWorkstreamId, workspaceId, Date.now())
        }

        targetSessionId =
          sourceAccessKind === 'direct'
            ? insertOwnedSession(creation, targetWorkstreamId, {
                access: 'direct',
                repositoryId: sourceRepositoryId!,
                title,
                fork: { parentSessionId: sessionId, entryId: options.entryId },
              })
            : insertOwnedSession(creation, targetWorkstreamId, {
                access: 'managed',
                title,
                fork: { parentSessionId: sessionId, entryId: options.entryId },
              })
        if (sourceAccessKind === 'direct') {
          if (sourceWorkingLocation === 'current-checkouts') {
            insertCurrentCheckoutSessionLocation(creation, targetSessionId, sourceRepositoryId!)
          } else {
            insertSessionWorkingLocationsFromWorkstream(
              creation,
              targetSessionId,
              targetWorkstreamId,
              sourceRepositoryId!
            )
          }
        }
        incrementRevision(creation)
        creation.exec('COMMIT;')
      } catch (error) {
        try {
          creation.exec('ROLLBACK;')
        } catch {
          // The durable fork intent may already have committed.
        }
        throw error
      } finally {
        creation.close()
      }

      const status = await reconcileCommittedSession(targetSessionId)

      return {
        status,
        sessionId: targetSessionId,
        draft: forkPoint.text,
        snapshot: await getWorkstreamSnapshot(workspaceId, false),
      }
    } finally {
      const settled = openDatabase()
      try {
        settled
          .prepare("DELETE FROM session_run_leases WHERE session_id = ? AND purpose = 'session-fork' AND lease_id = ?")
          .run(sessionId, leaseId)
      } finally {
        settled.close()
      }
    }
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
        throw new TypeError('Set a Workstream goal before creating a Session.')
      }

      workspaceId = String(workstream.workspace_id)
      sessionId = insertOwnedSession(database, workstreamId, { access: 'managed', title: options.title })
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

  async function setSessionDescription(sessionId: SessionId, description: string): Promise<WorkstreamsSnapshot> {
    const normalizedDescription = normalizeSessionDescription(description)

    if (!normalizedDescription) throw new TypeError('A Session description is required.')

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
      database.prepare('UPDATE sessions SET description = ? WHERE id = ?').run(normalizedDescription, sessionId)
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
    const database = openDatabase()

    try {
      await reconcilePendingSessionFiles(database)
      const row = database
        .prepare(
          `SELECT s.id, s.access_kind, s.creation_status, s.pi_session_id,
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
      if (row.access_kind !== 'direct' && row.access_kind !== 'managed') {
        throw new Error('The Session has unsupported Repository access.')
      }

      try {
        parseWorkstreamLifecycle(row.lifecycle)
        parseWorkstreamWorkingLocation(row.working_location)
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
      const canSubmit = row.lifecycle === 'active'
      const toolAccess = canSubmit ? 'full' : 'none'
      let managedPolicy: ManagedSessionRuntimePolicy | undefined

      if (row.access_kind === 'managed') {
        try {
          let workingLocationRevision = Number(row.working_location_revision)
          const repositoryRows = database
            .prepare(
              `SELECT repository.id, repository.directory_path, repository.common_directory_path,
                  repository.availability, membership.id AS membership_id, membership.role, membership.relationships,
                  membership.validation_commands, location.kind AS location_kind, location.working_path, location.branch,
                  location.availability AS location_availability
             FROM workstream_repositories selected
             JOIN workspace_repositories membership
               ON membership.workspace_id = ? AND membership.repository_id = selected.repository_id
             JOIN repositories repository ON repository.id = membership.repository_id
             LEFT JOIN session_repository_locations location
               ON location.session_id = ? AND location.repository_id = repository.id
            WHERE selected.workstream_id = ?
            ORDER BY membership.rowid`
            )
            .all(row.workspace_id, sessionId, row.workstream_id)
          const repositoryIdByMembershipId = new Map(
            database
              .prepare('SELECT id, repository_id FROM workspace_repositories WHERE workspace_id = ?')
              .all(row.workspace_id)
              .map((membership) => [String(membership.id), String(membership.repository_id)])
          )
          const repositories = await Promise.all(
            repositoryRows.map(async (repository) => {
              const repositoryAvailability = parseSessionAvailability(repository.availability)
              const locationKind =
                repository.location_kind === undefined || repository.location_kind === null
                  ? undefined
                  : parseWorkstreamRepositoryLocationKind(repository.location_kind)
              const sessionWorkingPath =
                locationKind === 'worktree' && typeof repository.working_path === 'string'
                  ? repository.working_path
                  : undefined
              const sessionWorkingBranch =
                locationKind === 'worktree' && typeof repository.branch === 'string' ? repository.branch : undefined
              let usesSessionWorktree = false

              if (sessionWorkingPath && sessionWorkingBranch && repository.location_availability === 'available') {
                const observedAvailability = await inspectWorktree({
                  worktreePath: sessionWorkingPath,
                  commonDirectoryPath: String(repository.common_directory_path),
                  expectedBranch: sessionWorkingBranch,
                })
                usesSessionWorktree = observedAvailability === 'available'

                if (!usesSessionWorktree) {
                  database
                    .prepare(
                      "UPDATE session_repository_locations SET availability = 'unavailable' WHERE session_id = ? AND repository_id = ?"
                    )
                    .run(sessionId, repository.id)
                  database
                    .prepare(
                      'UPDATE workstreams SET working_location_revision = working_location_revision + 1 WHERE id = ?'
                    )
                    .run(row.workstream_id)
                  workingLocationRevision += 1
                  incrementRevision(database)
                }
              }

              const workingPath = usesSessionWorktree ? sessionWorkingPath : repository.directory_path
              const locationAvailability = usesSessionWorktree ? 'available' : repositoryAvailability

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
                validationCommands: parseStringArray(repository.validation_commands),
              }

              return availability === 'available' && typeof workingPath === 'string'
                ? {
                    ...properties,
                    availability: 'available' as const,
                    workingPath,
                    workingLocation: usesSessionWorktree ? ('session-worktree' as const) : ('source-checkout' as const),
                  }
                : { ...properties, availability: 'unavailable' as const }
            })
          )
          const lease = database.prepare('SELECT lease_id FROM session_run_leases WHERE session_id = ?').get(sessionId)

          managedPolicy = {
            workspaceId: String(row.workspace_id),
            workstreamId: String(row.workstream_id),
            sessionId,
            goal: String(row.goal),
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

  function resolveQuickSessionBranchLocation(sessionId: SessionId, repositoryId: string) {
    const database = openDatabase()

    try {
      const location = database
        .prepare(
          `SELECT session.workstream_id, location.kind, location.working_path
             FROM sessions session
             JOIN workstreams workstream ON workstream.id = session.workstream_id
             JOIN session_repository_locations location
               ON location.session_id = session.id AND location.repository_id = ?
            WHERE session.id = ?
              AND session.repository_id = ?
              AND session.access_kind = 'direct'
              AND session.creation_status = 'finalized'
              AND workstream.lifecycle = 'active'`
        )
        .get(repositoryId, sessionId, repositoryId)

      if (!location) throw new TypeError('The Quick Session Repository is unavailable.')

      return {
        workstreamId: String(location.workstream_id),
        kind: parseWorkstreamRepositoryLocationKind(location.kind),
        workingPath: String(location.working_path),
      }
    } finally {
      database.close()
    }
  }

  async function getSessionBranches(
    sessionId: SessionId,
    repositoryId: string,
    refresh: boolean
  ): Promise<SessionRepositoryBranchesSnapshot> {
    const location = resolveQuickSessionBranchLocation(sessionId, repositoryId)
    let branches: readonly GitBranchReference[]
    let refreshError: string | undefined

    if (refresh) {
      try {
        branches = await fetchBranches(location.workingPath)
      } catch {
        branches = await listBranches(location.workingPath)
        refreshError = 'Remote branches could not be refreshed. Check network access and Git credentials, then retry.'
      }
    } else {
      branches = await listBranches(location.workingPath)
    }

    return {
      sessionId,
      repositoryId,
      branches,
      ...(refreshError ? { refreshError } : {}),
    }
  }

  async function switchQuickSessionBranch(
    sessionId: SessionId,
    repositoryId: string,
    branchRef: string
  ): Promise<SessionWorkingLocationsSnapshot> {
    const location = resolveQuickSessionBranchLocation(sessionId, repositoryId)
    const branch = (await listBranches(location.workingPath)).find((candidate) => candidate.ref === branchRef)
    if (!branch) throw new TypeError('That branch is no longer available in this Repository.')

    const selectedBranch = await switchBranch(location.workingPath, branch)
    const database = openDatabase()

    try {
      database.exec('BEGIN IMMEDIATE;')
      database
        .prepare('UPDATE session_repository_locations SET branch = ? WHERE session_id = ? AND repository_id = ?')
        .run(selectedBranch, sessionId, repositoryId)
      if (location.kind === 'worktree') {
        database
          .prepare(
            'UPDATE workstream_repository_locations SET branch = ? WHERE workstream_id = ? AND repository_id = ?'
          )
          .run(selectedBranch, location.workstreamId, repositoryId)
        incrementSessionWorkingLocationRevision(database, sessionId)
      }
      incrementRevision(database)
      database.exec('COMMIT;')
    } catch (error) {
      database.exec('ROLLBACK;')
      throw error
    } finally {
      database.close()
    }

    return getSessionWorkingLocations(sessionId)
  }

  async function getSessionWorkingLocations(sessionId: SessionId): Promise<SessionWorkingLocationsSnapshot> {
    const resolution = await resolveOwnedSession(sessionId)
    if (!resolution) throw new TypeError('The Session is unavailable.')

    if (!resolution.managedPolicy) {
      const database = openDatabase()

      try {
        const location = database
          .prepare(
            `SELECT location.repository_id, location.kind, location.working_path, repository.directory_path
               FROM sessions session
               JOIN session_repository_locations location ON location.session_id = session.id
               JOIN repositories repository ON repository.id = location.repository_id
              WHERE session.id = ? AND session.access_kind = 'direct'`
          )
          .get(sessionId)

        if (!location) return { sessionId, repositories: [] }

        const properties = {
          repositoryId: String(location.repository_id),
          repositoryName: repositoryName(String(location.directory_path)),
          kind: parseWorkstreamRepositoryLocationKind(location.kind),
        }

        try {
          const workingPath = String(location.working_path)

          return {
            sessionId,
            repositories: [
              {
                ...properties,
                availability: 'available',
                branch: await inspectBranch(workingPath),
                workingPath,
              },
            ],
          }
        } catch {
          return { sessionId, repositories: [{ ...properties, availability: 'unavailable' }] }
        }
      } finally {
        database.close()
      }
    }

    const repositories = await Promise.all(
      resolution.managedPolicy.repositories.map(async (repository) => {
        if (repository.availability !== 'available') {
          return {
            repositoryId: repository.id,
            repositoryName: repository.name,
            kind: 'current-checkout' as const,
            availability: 'unavailable' as const,
          }
        }

        const kind =
          repository.workingLocation === 'session-worktree' ? ('worktree' as const) : ('current-checkout' as const)

        try {
          return {
            repositoryId: repository.id,
            repositoryName: repository.name,
            kind,
            availability: 'available' as const,
            branch: await inspectBranch(repository.workingPath),
            workingPath: repository.workingPath,
          }
        } catch {
          return {
            repositoryId: repository.id,
            repositoryName: repository.name,
            kind,
            availability: 'unavailable' as const,
          }
        }
      })
    )

    return { sessionId, repositories }
  }

  async function resolveSessionChangeRepositories(
    sessionId: SessionId
  ): Promise<readonly SessionChangeRepositoryLocation[]> {
    const database = openDatabase()

    try {
      const session = database.prepare('SELECT access_kind, creation_status FROM sessions WHERE id = ?').get(sessionId)

      if (!session || session.creation_status !== 'finalized') return []
      if (session.access_kind !== 'direct' && session.access_kind !== 'managed') return []

      const rows = database
        .prepare(
          `SELECT location.repository_id, repository.directory_path, location.working_path
             FROM session_repository_locations location
             JOIN repositories repository ON repository.id = location.repository_id
            WHERE location.session_id = ?
              AND location.availability = 'available'
            ORDER BY location.rowid`
        )
        .all(sessionId)

      return rows.map((row) => ({
        repositoryId: String(row.repository_id),
        repositoryName: repositoryName(String(row.directory_path)),
        workingPath: String(row.working_path),
      }))
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
    createSessionWorktree,
    prepareSessionRepository,
    createWorkstreamSession,
    getSessionForkPoints,
    forkSession,
    setWorkstreamLifecycle,
    renameWorkstreamSession,
    setSessionDescription,
    resolveOwnedSession,
    getSessionBranches,
    switchQuickSessionBranch,
    getSessionWorkingLocations,
    resolveSessionChangeRepositories,
    resolveWorkstreamWorkingLocation,
    getCurrentWorkstreamRepositorySet,
  }
}

function userMessageText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''

  return content
    .flatMap((part) =>
      typeof part === 'object' && part !== null && (part as { type?: unknown }).type === 'text'
        ? [String((part as { text?: unknown }).text ?? '')]
        : []
    )
    .join('')
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
