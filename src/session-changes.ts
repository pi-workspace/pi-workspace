import type { SessionId } from '@/src/domain/session'

export type SessionChangeFileStatus =
  'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'untracked' | 'conflicted'

export type SessionChangeFile = Readonly<{
  path: string
  previousPath?: string
  status: SessionChangeFileStatus
  staged: boolean
  unstaged: boolean
  additions?: number
  deletions?: number
  binary?: boolean
}>

export type SessionChangesBranch = Readonly<{
  head: string
  upstream?: string
  ahead: number
  behind: number
  detached: boolean
  unborn: boolean
}>

export type SessionRepositoryChanges = Readonly<{
  repositoryId: string
  repositoryName: string
  branch: SessionChangesBranch
  files: readonly SessionChangeFile[]
  error?: string
}>

export type SessionChangesSnapshot = Readonly<{
  sessionId: SessionId
  repositories: readonly SessionRepositoryChanges[]
}>

export type SessionFileDiffView = 'all' | 'staged' | 'unstaged'

export type SessionFileDiff = Readonly<{
  status: 'available' | 'binary' | 'too-large' | 'unavailable'
  content?: string
  truncated?: boolean
  message?: string
}>

export interface SessionChangesBridge {
  getSnapshot(sessionId: SessionId): Promise<SessionChangesSnapshot>
  loadFileDiff(
    sessionId: SessionId,
    repositoryId: string,
    path: string,
    view: SessionFileDiffView
  ): Promise<SessionFileDiff>
  setFileStaged(
    sessionId: SessionId,
    repositoryId: string,
    path: string,
    staged: boolean
  ): Promise<SessionChangesSnapshot>
}
