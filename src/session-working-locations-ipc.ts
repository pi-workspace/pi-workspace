import { isSessionId, type SessionId } from '@/src/domain/session'

export const sessionWorkingLocationsIpcChannels = {
  get: 'session-working-locations:get',
  createWorktree: 'session-working-locations:create-worktree',
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
