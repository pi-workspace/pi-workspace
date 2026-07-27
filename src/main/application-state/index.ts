import type { ApplicationStateStartup, WorkspaceMembershipUpdate, WorkspacesSnapshot } from '@/src/application-state'
import type { SessionId } from '@/src/domain/session'
import type {
  WorkstreamKnowledge,
  WorkstreamKnowledgeCommand,
  WorkstreamKnowledgeMutationResult,
} from '@/src/domain/workstream-knowledge-transitions'
import type {
  CreateQuickSessionOptions,
  CreateSessionOptions,
  CreateWorkstreamOptions,
  ForkSessionOptions,
  SessionForkPoint,
  WorkstreamLifecycle,
  WorkstreamsSnapshot,
  WorktreeLocationsPreview,
} from '@/src/domain/workstream'
import {
  createWorktree as createGitWorktree,
  inspectGitBranch,
  inspectGitRepository,
  restoreWorktree as restoreGitWorktree,
  type InspectedGitRepository,
  type WorktreeProposal,
} from '@/src/main/git-repositories'
import { createPiSessionFileStore, type PiSessionFileStore } from '@/src/main/pi-session-files'
import type { SessionWorkingLocationsSnapshot } from '@/src/session-working-locations'
import type { SqliteModule } from './sqlite'
import { createRunLeaseStore } from './run-lease-store'
import { createSessionFileReconciliation } from './session-file-reconciliation'
import { createWorkspaceRepositoryStore } from './workspace-repository-store'
import { createWorkstreamKnowledgeFacade } from './workstream-knowledge-facade'
import {
  createWorkstreamSessionStore,
  type OwnedSessionResolution,
  type PreparedSessionRepository,
  type SessionChangeRepositoryLocation,
  type SessionForkResult,
  type WorkstreamCreationResult,
} from './workstream-session-store'
import { incrementRevision, initializeApplicationStateStore, loadSqlite } from './application-state-store'

export type { SqliteDatabase, SqliteModule } from './sqlite'

type RepositoryInspector = (directoryPath: string) => Promise<InspectedGitRepository>
type BranchInspector = (directoryPath: string) => Promise<string>

export type ApplicationAuthorityOptions = Readonly<{
  sqlite?: SqliteModule
  sessionFiles?: PiSessionFileStore
  inspectRepository?: RepositoryInspector
  inspectBranch?: BranchInspector
  createWorktree?: (proposal: WorktreeProposal) => Promise<WorktreeProposal>
}>

export type {
  OwnedSessionResolution,
  PreparedSessionRepository,
  SessionChangeRepositoryLocation,
  SessionForkResult,
  WorkstreamCreationResult,
} from './workstream-session-store'

export type ApplicationAuthority = Readonly<{
  startup: ApplicationStateStartup
  createBackup(): Promise<string>
  reset(): Promise<ApplicationStateStartup>
  getWorkspaces(): Promise<WorkspacesSnapshot>
  createWorkspace(name: string, selectedDirectoryPaths: readonly string[]): Promise<WorkspacesSnapshot>
  renameWorkspace(workspaceId: string, name: string): Promise<WorkspacesSnapshot>
  addWorkspaceRepositories(workspaceId: string, selectedDirectoryPaths: readonly string[]): Promise<WorkspacesSnapshot>
  removeWorkspaceRepository(workspaceId: string, membershipId: string): Promise<WorkspacesSnapshot>
  updateWorkspaceMembership(
    workspaceId: string,
    membershipId: string,
    update: WorkspaceMembershipUpdate
  ): Promise<WorkspacesSnapshot>
  getWorkstreamSnapshot(workspaceId: string): Promise<WorkstreamsSnapshot>
  previewWorktreeLocations(workspaceId: string, repositoryId: string): Promise<WorktreeLocationsPreview>
  createWorkstream(workspaceId: string, options: CreateWorkstreamOptions): Promise<WorkstreamCreationResult>
  createQuickSession(workspaceId: string, options: CreateQuickSessionOptions): Promise<WorkstreamCreationResult>
  createSessionWorktree(sessionId: SessionId, repositoryId: string): Promise<PreparedSessionRepository>
  prepareSessionRepository(sessionId: SessionId, repositoryId: string): Promise<PreparedSessionRepository>
  createWorkstreamSession(workstreamId: string, options: CreateSessionOptions): Promise<WorkstreamCreationResult>
  getSessionForkPoints(sessionId: SessionId): Promise<readonly SessionForkPoint[]>
  forkSession(sessionId: SessionId, options: ForkSessionOptions): Promise<SessionForkResult>
  setWorkstreamLifecycle(workstreamId: string, lifecycle: WorkstreamLifecycle): Promise<WorkstreamsSnapshot>
  renameWorkstreamSession(sessionId: SessionId, title: string): Promise<WorkstreamsSnapshot>
  setSessionDescription(sessionId: SessionId, description: string): Promise<WorkstreamsSnapshot>
  resolveOwnedSession(sessionId: SessionId): Promise<OwnedSessionResolution | undefined>
  getSessionWorkingLocations(sessionId: SessionId): Promise<SessionWorkingLocationsSnapshot>
  resolveSessionChangeRepositories(sessionId: SessionId): Promise<readonly SessionChangeRepositoryLocation[]>
  resolveWorkstreamWorkingLocation(workstreamId: string, repositoryId: string): Promise<string>
  getWorkstreamKnowledge(workstreamId: string): Promise<WorkstreamKnowledge>
  applyUserWorkstreamKnowledgeCommand(
    workstreamId: string,
    command: WorkstreamKnowledgeCommand
  ): Promise<WorkstreamKnowledgeMutationResult>
  applyPiWorkstreamKnowledgeCommand(
    workstreamId: string,
    command: WorkstreamKnowledgeCommand,
    sessionId: SessionId
  ): Promise<WorkstreamKnowledgeMutationResult>
  subscribeWorkstreamKnowledge(listener: (state: WorkstreamKnowledge) => void): () => void
  acquireSessionRunLease(sessionId: SessionId): Promise<boolean>
  settleSessionRunLease(sessionId: SessionId): Promise<boolean>
  acquireSessionCompactionLease(sessionId: SessionId): Promise<boolean>
  settleSessionCompactionLease(sessionId: SessionId): Promise<boolean>
  getCurrentWorkstreamRepositorySet(workstreamId: string): Promise<readonly string[]>
}>

export async function initializeApplicationAuthority(
  storageDirectory: string,
  options: ApplicationAuthorityOptions = {}
): Promise<ApplicationAuthority> {
  const sqlite = options.sqlite ?? (await loadSqlite())
  const applicationStateStore = await initializeApplicationStateStore(storageDirectory, sqlite)
  const { createBackup, reset, openDatabase } = applicationStateStore
  const sessionFiles = options.sessionFiles ?? (await createPiSessionFileStore(storageDirectory))
  const inspectRepository = options.inspectRepository ?? inspectGitRepository
  const inspectBranch = options.inspectBranch ?? inspectGitBranch
  const createWorktree = options.createWorktree ?? createGitWorktree

  const workspaceRepositoryStore = createWorkspaceRepositoryStore({
    openDatabase,
    inspectRepository,
    incrementRevision,
  })
  const sessionFileReconciliation = createSessionFileReconciliation({
    openDatabase,
    sessionFiles,
    incrementRevision,
  })
  const runLeaseStore = createRunLeaseStore({ openDatabase })
  const workstreamKnowledgeFacade = createWorkstreamKnowledgeFacade({ openDatabase })

  const {
    getWorkspaces,
    createWorkspace,
    renameWorkspace,
    addWorkspaceRepositories,
    removeWorkspaceRepository,
    updateWorkspaceMembership,
  } = workspaceRepositoryStore
  const { reconcilePendingSessionFiles, refreshOwnedSessionAvailability, reconcileCommittedSession } =
    sessionFileReconciliation
  const {
    acquireSessionRunLease,
    settleSessionRunLease,
    acquireSessionCompactionLease,
    settleSessionCompactionLease,
    acquireSessionWorktreeLease,
    settleSessionWorktreeLease,
  } = runLeaseStore
  const {
    getWorkstreamKnowledge,
    applyUserWorkstreamKnowledgeCommand,
    applyPiWorkstreamKnowledgeCommand,
    subscribeWorkstreamKnowledge,
  } = workstreamKnowledgeFacade

  const workstreamSessionStore = createWorkstreamSessionStore({
    openDatabase,
    inspectRepository,
    inspectBranch,
    createWorktree,
    restoreWorktree: restoreGitWorktree,
    sessionFiles,
    incrementRevision,
    reconcilePendingSessionFiles,
    refreshOwnedSessionAvailability,
    reconcileCommittedSession,
  })
  const {
    getWorkstreamSnapshot,
    previewWorktreeLocations,
    createWorkstream,
    createQuickSession,
    createSessionWorktree: createPersistedSessionWorktree,
    prepareSessionRepository,
    createWorkstreamSession,
    getSessionForkPoints,
    forkSession,
    setWorkstreamLifecycle,
    renameWorkstreamSession,
    setSessionDescription,
    resolveOwnedSession,
    getSessionWorkingLocations,
    resolveSessionChangeRepositories,
    resolveWorkstreamWorkingLocation,
    getCurrentWorkstreamRepositorySet,
  } = workstreamSessionStore

  const createSessionWorktree = async (sessionId: SessionId, repositoryId: string) => {
    if (!(await acquireSessionWorktreeLease(sessionId))) {
      throw new TypeError('Wait for the Session to become idle before creating a worktree.')
    }

    try {
      return await createPersistedSessionWorktree(sessionId, repositoryId)
    } finally {
      await settleSessionWorktreeLease(sessionId)
    }
  }

  return {
    get startup() {
      return applicationStateStore.startup
    },
    createBackup,
    reset,
    getWorkspaces,
    createWorkspace,
    renameWorkspace,
    addWorkspaceRepositories,
    removeWorkspaceRepository,
    updateWorkspaceMembership,
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
    getSessionWorkingLocations,
    resolveSessionChangeRepositories,
    resolveWorkstreamWorkingLocation,
    getWorkstreamKnowledge,
    applyUserWorkstreamKnowledgeCommand,
    applyPiWorkstreamKnowledgeCommand,
    subscribeWorkstreamKnowledge,
    acquireSessionRunLease,
    settleSessionRunLease,
    acquireSessionCompactionLease,
    settleSessionCompactionLease,
    getCurrentWorkstreamRepositorySet,
  }
}
