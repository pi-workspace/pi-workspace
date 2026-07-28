import { isSessionId, type SessionId } from '@/src/domain/session'

export const sessionWorkingLocationsIpcChannels = {
  get: 'session-working-locations:get',
  getBranches: 'session-working-locations:get-branches',
  switchBranch: 'session-working-locations:switch-branch',
  createWorktree: 'session-working-locations:create-worktree',
  changed: 'session-working-locations:changed',
} as const

export function parseSessionWorkingLocationRequest(
  value: unknown
): Readonly<{ sessionId: SessionId; repositoryId?: string }> | undefined {
  if (typeof value !== 'object' || value === null) return undefined

  const sessionId = (value as { sessionId?: unknown }).sessionId
  const repositoryId = (value as { repositoryId?: unknown }).repositoryId

  if (!isSessionId(sessionId)) return undefined
  if (
    repositoryId !== undefined &&
    (typeof repositoryId !== 'string' || repositoryId.length === 0 || repositoryId.length > 256)
  ) {
    return undefined
  }

  return { sessionId, ...(repositoryId ? { repositoryId } : {}) }
}

export function parseSessionBranchRequest(
  value: unknown
): Readonly<{ sessionId: SessionId; repositoryId: string; refresh?: boolean; branchRef?: string }> | undefined {
  const request = parseSessionWorkingLocationRequest(value)
  if (!request?.repositoryId) return undefined

  const refresh = (value as { refresh?: unknown }).refresh
  const branchRef = (value as { branchRef?: unknown }).branchRef
  if (refresh !== undefined && typeof refresh !== 'boolean') return undefined
  if (branchRef !== undefined && (typeof branchRef !== 'string' || branchRef.length === 0 || branchRef.length > 1024)) {
    return undefined
  }
  if (refresh !== undefined && branchRef !== undefined) return undefined

  return {
    sessionId: request.sessionId,
    repositoryId: request.repositoryId,
    ...(refresh === undefined ? {} : { refresh }),
    ...(branchRef === undefined ? {} : { branchRef }),
  }
}
