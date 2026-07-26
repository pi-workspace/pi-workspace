import { isSessionId, type SessionId } from '@/src/domain/session'
import type { SessionFileDiffView } from '@/src/session-changes'

export const sessionChangesIpcChannels = {
  getSnapshot: 'session-changes:get-snapshot',
  loadFileDiff: 'session-changes:load-file-diff',
} as const

export function parseSessionChangesRequest(value: unknown): Readonly<{ sessionId: SessionId }> | undefined {
  if (typeof value !== 'object' || value === null) return undefined

  const sessionId = (value as { sessionId?: unknown }).sessionId
  return isSessionId(sessionId) ? { sessionId } : undefined
}

export function parseSessionFileDiffRequest(
  value: unknown
): Readonly<{ sessionId: SessionId; repositoryId: string; path: string; view: SessionFileDiffView }> | undefined {
  const request = parseSessionChangesRequest(value)
  if (!request) return undefined

  const repositoryId = (value as { repositoryId?: unknown }).repositoryId
  const path = (value as { path?: unknown }).path
  const view = (value as { view?: unknown }).view

  if (
    typeof repositoryId !== 'string' ||
    repositoryId.length === 0 ||
    repositoryId.length > 256 ||
    typeof path !== 'string' ||
    path.length === 0 ||
    path.length > 8_192 ||
    (view !== 'all' && view !== 'staged' && view !== 'unstaged')
  ) {
    return undefined
  }

  return { ...request, repositoryId, path, view }
}
