import type { SessionId } from './session'

export type WorkstreamLifecycle = 'active' | 'archived'
export type WorkstreamWorkingLocation = 'current-checkouts' | 'worktrees'
export type SessionAvailability = 'available' | 'unavailable'
export type DirectSessionRepositoryAccess = Readonly<{
  kind: 'direct'
  repositoryId: string
  repositoryName: string
  availability: SessionAvailability
}>

export type ManagedSessionRepositoryAccess = Readonly<{ kind: 'managed' }>

type OwnedSessionProperties = Readonly<{
  id: SessionId
  workstreamId: string
  title: string
  description?: string
  availability: SessionAvailability
}>

export type OwnedSession = OwnedSessionProperties &
  Readonly<{
    repositoryAccess: DirectSessionRepositoryAccess | ManagedSessionRepositoryAccess
  }>

export type WorkstreamRepositoryWorkingLocation = Readonly<{
  repositoryId: string
  repositoryName: string
  kind: 'current-checkout' | 'worktree'
}> &
  (Readonly<{ availability: 'available'; workingPath: string }> | Readonly<{ availability: 'unavailable' }>)

export type Workstream = Readonly<{
  id: string
  workspaceId: string
  goal?: string
  lifecycle: WorkstreamLifecycle
  workingLocation: WorkstreamWorkingLocation
  repositoryWorkingLocations: readonly WorkstreamRepositoryWorkingLocation[]
  sessions: readonly OwnedSession[]
  unavailability?: string
}>

export type WorkstreamsSnapshot = Readonly<{
  revision: number
  workstreams: readonly Workstream[]
}>

export type WorktreeLocationPreview = Readonly<{
  repositoryId: string
  repositoryName: string
  workingPath: string
  branch: string
  baseCommit: string
}>

export type WorktreeLocationsPreview = Readonly<{
  workstreamId: string
  repositories: readonly WorktreeLocationPreview[]
}>

export type SessionForkPoint = Readonly<{
  entryId: string
  text: string
  position: number
  total: number
}>

export type ForkSessionOptions = Readonly<{
  entryId: string
  title: string
}>

export type CreateWorkstreamOptions = Readonly<{
  goal: string
  repositoryIds?: readonly string[]
}>

export type CreateQuickSessionOptions = Readonly<{
  repositoryId: string
  workingLocation?: WorkstreamWorkingLocation
  workstreamId?: string
}>

export type CreateSessionOptions = Readonly<{
  title?: string
}>

export function normalizeWorkstreamGoal(goal: string): string {
  const normalizedGoal = goal.trim()

  if (!normalizedGoal) throw new TypeError('A Workstream goal is required.')

  return normalizedGoal
}
