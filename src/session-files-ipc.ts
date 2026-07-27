import { isSessionId, type SessionId } from '@/src/domain/session'

export const sessionFilesIpcChannels = {
  getAvailable: 'session-files:get-available',
} as const

export function parseSessionFilesRequest(
  value: unknown
): Readonly<{ sessionId: SessionId; query?: string }> | undefined {
  if (typeof value !== 'object' || value === null) return undefined

  const request = value as Record<string, unknown>
  if (!isSessionId(request.sessionId) || (request.query !== undefined && typeof request.query !== 'string'))
    return undefined

  return { sessionId: request.sessionId, query: request.query }
}
