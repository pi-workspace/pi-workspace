import { isSessionId, type SessionId } from '@/src/domain/session'
import {
  managedSessionModes,
  type CreateQuickSessionOptions,
  type CreateSessionOptions,
  type CreateWorkstreamOptions,
} from '@/src/domain/workstream'

export const workstreamsIpcChannels = {
  getSnapshot: 'workstreams:get-snapshot',
  previewWorktreeLocations: 'workstreams:preview-worktree-locations',
  createWorkstream: 'workstreams:create-workstream',
  createQuickSession: 'workstreams:create-quick-session',
  createSession: 'workstreams:create-session',
  setLifecycle: 'workstreams:set-lifecycle',
  renameSession: 'workstreams:rename-session',
  showWorkingLocation: 'workstreams:show-working-location',
  changed: 'workstreams:changed',
} as const

export function parsePreviewWorktreeLocationsRequest(
  value: unknown
): Readonly<{ workspaceId: string; repositoryId: string }> | undefined {
  if (typeof value !== 'object' || value === null) return undefined

  const workspaceId = (value as { workspaceId?: unknown }).workspaceId
  const repositoryId = (value as { repositoryId?: unknown }).repositoryId

  if (typeof workspaceId !== 'string' || typeof repositoryId !== 'string' || !repositoryId) return undefined

  return { workspaceId, repositoryId }
}

export function parseCreateWorkstreamRequest(
  value: unknown
): Readonly<{ workspaceId: string; options: CreateWorkstreamOptions }> | undefined {
  if (typeof value !== 'object' || value === null) return undefined

  const workspaceId = (value as { workspaceId?: unknown }).workspaceId
  const goal = (value as { goal?: unknown }).goal
  const mode = (value as { mode?: unknown }).mode

  if (typeof workspaceId !== 'string' || typeof goal !== 'string' || !isOptionalSessionMode(mode)) {
    return undefined
  }

  return {
    workspaceId,
    options: {
      goal,
      ...(mode ? { mode } : {}),
    },
  }
}

export function parseCreateQuickSessionRequest(
  value: unknown
): Readonly<{ workspaceId: string; options: CreateQuickSessionOptions }> | undefined {
  if (typeof value !== 'object' || value === null) return undefined

  const workspaceId = (value as { workspaceId?: unknown }).workspaceId
  const repositoryId = (value as { repositoryId?: unknown }).repositoryId
  const workingLocation = (value as { workingLocation?: unknown }).workingLocation
  const workstreamId = (value as { workstreamId?: unknown }).workstreamId

  if (
    typeof workspaceId !== 'string' ||
    typeof repositoryId !== 'string' ||
    !isOptionalWorkingLocation(workingLocation) ||
    (workingLocation === 'worktrees' && (typeof workstreamId !== 'string' || !isUuid(workstreamId))) ||
    (workstreamId !== undefined && (typeof workstreamId !== 'string' || !isUuid(workstreamId)))
  ) {
    return undefined
  }

  return {
    workspaceId,
    options: {
      repositoryId,
      ...(workingLocation ? { workingLocation } : {}),
      ...(workstreamId ? { workstreamId } : {}),
    },
  }
}

export function parseCreateSessionRequest(
  value: unknown
): Readonly<{ workstreamId: string; options: CreateSessionOptions }> | undefined {
  if (typeof value !== 'object' || value === null) return undefined

  const workstreamId = (value as { workstreamId?: unknown }).workstreamId
  const mode = (value as { mode?: unknown }).mode
  const title = (value as { title?: unknown }).title

  if (typeof workstreamId !== 'string' || !isSessionMode(mode) || (title !== undefined && typeof title !== 'string')) {
    return undefined
  }

  return { workstreamId, options: title === undefined ? { mode } : { mode, title } }
}

export function parseWorkstreamLifecycleRequest(
  value: unknown
): Readonly<{ workstreamId: string; lifecycle: 'active' | 'archived' }> | undefined {
  if (typeof value !== 'object' || value === null) return undefined

  const workstreamId = (value as { workstreamId?: unknown }).workstreamId
  const lifecycle = (value as { lifecycle?: unknown }).lifecycle

  return typeof workstreamId === 'string' && (lifecycle === 'active' || lifecycle === 'archived')
    ? { workstreamId, lifecycle }
    : undefined
}

export function parseShowWorkingLocationRequest(
  value: unknown
): Readonly<{ workstreamId: string; repositoryId: string }> | undefined {
  if (typeof value !== 'object' || value === null) return undefined

  const workstreamId = (value as { workstreamId?: unknown }).workstreamId
  const repositoryId = (value as { repositoryId?: unknown }).repositoryId

  return typeof workstreamId === 'string' && typeof repositoryId === 'string'
    ? { workstreamId, repositoryId }
    : undefined
}

export function parseRenameOwnedSessionRequest(
  value: unknown
): Readonly<{ sessionId: SessionId; title: string }> | undefined {
  if (typeof value !== 'object' || value === null) return undefined

  const id = (value as { sessionId?: unknown }).sessionId
  const title = (value as { title?: unknown }).title

  return isSessionId(id) && typeof title === 'string' ? { sessionId: id, title } : undefined
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-7][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function isOptionalWorkingLocation(value: unknown): value is CreateQuickSessionOptions['workingLocation'] {
  return value === undefined || value === 'current-checkouts' || value === 'worktrees'
}

function isOptionalSessionMode(value: unknown): value is CreateWorkstreamOptions['mode'] {
  return value === undefined || isSessionMode(value)
}

function isSessionMode(value: unknown): value is CreateSessionOptions['mode'] {
  return typeof value === 'string' && managedSessionModes.some((mode) => mode === value)
}
