import { isSessionId } from '@/src/domain/session'

export const sessionTranscriptIpcChannels = {
  getSnapshot: 'session-transcript:get-snapshot',
  getWorkingStateSnapshots: 'session-transcript:get-working-state-snapshots',
  loadActivityDetails: 'session-transcript:load-activity-details',
  acceptActionCard: 'session-transcript:accept-action-card',
  openExternalLink: 'session-transcript:open-external-link',
  changed: 'session-transcript:changed',
} as const

export function parseSessionTranscriptRequest(value: unknown): { sessionId: string } | undefined {
  if (typeof value !== 'object' || value === null) return undefined

  const sessionId = (value as Record<string, unknown>).sessionId

  return isSessionId(sessionId) ? { sessionId } : undefined
}

export function parseActionCardAcceptanceRequest(
  value: unknown
): { sessionId: string; actionCardId: string } | undefined {
  const request = parseSessionTranscriptRequest(value)
  if (!request || typeof (value as Record<string, unknown>).actionCardId !== 'string') return undefined

  const actionCardId = (value as Record<string, unknown>).actionCardId as string

  return actionCardId.length > 0 && actionCardId.length <= 256 ? { ...request, actionCardId } : undefined
}

export function parseTranscriptActivityDetailsRequest(
  value: unknown
): { sessionId: string; activityId: string } | undefined {
  const request = parseSessionTranscriptRequest(value)
  if (!request || typeof (value as Record<string, unknown>).activityId !== 'string') return undefined

  const activityId = (value as Record<string, unknown>).activityId as string

  return activityId.length > 0 && activityId.length <= 256 ? { ...request, activityId } : undefined
}
