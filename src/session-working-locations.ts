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

export interface SessionWorkingLocationsBridge {
  get(sessionId: SessionId): Promise<SessionWorkingLocationsSnapshot>
  createWorktree(sessionId: SessionId, repositoryId: string): Promise<SessionWorkingLocationsSnapshot>
}
