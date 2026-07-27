import type { SessionId } from './session'
import type { WorkstreamLifecycle } from './workstream'

type ManagedSessionRuntimeRepositoryProperties = Readonly<{
  id: string
  name: string
  commonDirectoryPath: string
  role: string
  relationships: readonly string[]
  validationCommands: readonly string[]
}>

export type ManagedSessionRuntimeRepository = ManagedSessionRuntimeRepositoryProperties &
  (
    | Readonly<{
        availability: 'available'
        workingPath: string
        workingLocation: 'source-checkout' | 'session-worktree'
      }>
    | Readonly<{ availability: 'unavailable' }>
  )

export type ManagedSessionRuntimePolicy = Readonly<{
  workspaceId: string
  workstreamId: string
  sessionId: SessionId
  goal: string
  lifecycle: WorkstreamLifecycle
  runLeaseId?: string
  repositories: readonly ManagedSessionRuntimeRepository[]
  piSessionPath: string
  resourcePolicyRevision: number
}>
