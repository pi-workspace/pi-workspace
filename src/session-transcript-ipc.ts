import { isSessionId } from '@/src/domain/session'

export const sessionTranscriptIpcChannels = {
  getSnapshot: 'session-transcript:get-snapshot',
  getWorkingStateSnapshots: 'session-transcript:get-working-state-snapshots',
  loadActivityDetails: 'session-transcript:load-activity-details',
  openExternalLink: 'session-transcript:open-external-link',
  changed: 'session-transcript:changed',
} as const

export function parseSessionTranscriptRequest(value: unknown): { sessionId: string } | undefined {
  if (typeof value !== 'object' || value === null) return undefined

  const sessionId = (value as Record<string, unknown>).sessionId

  return isSessionId(sessionId) ? { sessionId } : undefined
}

export function parseTranscriptActivityDetailsRequest(
  value: unknown
): { sessionId: string; activityId: string } | undefined {
  const request = parseSessionTranscriptRequest(value)
  if (!request || typeof (value as Record<string, unknown>).activityId !== 'string') return undefined

  const activityId = (value as Record<string, unknown>).activityId as string

  return activityId.length > 0 && activityId.length <= 256 ? { ...request, activityId } : undefined
}
