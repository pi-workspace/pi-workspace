import { isSessionId, type SessionId } from '@/src/domain/session'
import type { SessionFileDiffView } from '@/src/session-changes'

export const sessionChangesIpcChannels = {
  getSnapshot: 'session-changes:get-snapshot',
  loadFileDiff: 'session-changes:load-file-diff',
  setFileStaged: 'session-changes:set-file-staged',
} as const

export function parseSessionChangesRequest(value: unknown): Readonly<{ sessionId: SessionId }> | undefined {
  if (typeof value !== 'object' || value === null) return undefined

  const sessionId = (value as { sessionId?: unknown }).sessionId
  return isSessionId(sessionId) ? { sessionId } : undefined
}

export function parseSessionFileDiffRequest(
  value: unknown
): Readonly<{ sessionId: SessionId; repositoryId: string; path: string; view: SessionFileDiffView }> | undefined {
  const request = parseSessionFileRequest(value)
  if (!request) return undefined

  const view = (value as { view?: unknown }).view
  if (view !== 'all' && view !== 'staged' && view !== 'unstaged') return undefined

  return { ...request, view }
}

export function parseSessionFileStageRequest(
  value: unknown
): Readonly<{ sessionId: SessionId; repositoryId: string; path: string; staged: boolean }> | undefined {
  const request = parseSessionFileRequest(value)
  if (!request) return undefined

  const staged = (value as { staged?: unknown }).staged
  return typeof staged === 'boolean' ? { ...request, staged } : undefined
}

function parseSessionFileRequest(
  value: unknown
): Readonly<{ sessionId: SessionId; repositoryId: string; path: string }> | undefined {
  const request = parseSessionChangesRequest(value)
  if (!request) return undefined

  const repositoryId = (value as { repositoryId?: unknown }).repositoryId
  const path = (value as { path?: unknown }).path

  if (
    typeof repositoryId !== 'string' ||
    repositoryId.length === 0 ||
    repositoryId.length > 256 ||
    typeof path !== 'string' ||
    path.length === 0 ||
    path.length > 8_192
  ) {
    return undefined
  }

  return { ...request, repositoryId, path }
}
