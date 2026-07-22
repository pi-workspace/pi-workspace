import { isSessionId, type SessionId } from '@/src/domain/session'

export const sessionSkillsIpcChannels = {
  getAvailable: 'session-skills:get-available',
} as const

export function parseSessionSkillsRequest(value: unknown): Readonly<{ sessionId: SessionId }> | undefined {
  if (typeof value !== 'object' || value === null) return undefined

  const request = value as Record<string, unknown>

  return Object.keys(request).length === 1 && isSessionId(request.sessionId)
    ? { sessionId: request.sessionId }
    : undefined
}
