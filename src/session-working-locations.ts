import type { SessionId } from '@/src/domain/session'

export type SessionRepositoryWorkingLocation = Readonly<{
  repositoryId: string
  repositoryName: string
  kind: 'current-checkout' | 'worktree'
}> &
  (
    | Readonly<{ availability: 'available'; branch: string; workingPath: string }>
    | Readonly<{ availability: 'unavailable'; branch?: never; workingPath?: never }>
  )

export type SessionWorkingLocationsSnapshot = Readonly<{
  sessionId: SessionId
  repositories: readonly SessionRepositoryWorkingLocation[]
}>

export type SessionRepositoryBranch = Readonly<{
  ref: string
  name: string
  kind: 'local' | 'remote'
  current: boolean
}>

export type SessionRepositoryBranchesSnapshot = Readonly<{
  sessionId: SessionId
  repositoryId: string
  branches: readonly SessionRepositoryBranch[]
  refreshError?: string
}>

export type SessionBranchQueryOptions = Readonly<{ refresh?: boolean }>

export interface SessionWorkingLocationsBridge {
  get(sessionId: SessionId): Promise<SessionWorkingLocationsSnapshot>
  getBranches(
    sessionId: SessionId,
    repositoryId: string,
    options?: SessionBranchQueryOptions
  ): Promise<SessionRepositoryBranchesSnapshot>
  switchBranch(sessionId: SessionId, repositoryId: string, branchRef: string): Promise<SessionWorkingLocationsSnapshot>
  createWorktree(sessionId: SessionId, repositoryId: string): Promise<SessionWorkingLocationsSnapshot>
  subscribe?(listener: () => void): () => void
}
