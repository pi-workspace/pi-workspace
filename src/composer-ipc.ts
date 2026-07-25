import { sessionMessageDeliveries, type SessionMessageSubmission } from '@/src/composer'
import { isSessionId } from '@/src/domain/session'

/** Session messages are bounded to limit retained IPC and provider work per submission. */
export const maximumSessionMessageLength = 200_000

export const composerIpcChannels = {
  submit: 'composer:submit',
  stop: 'composer:stop',
  removeQueuedFollowUp: 'composer:remove-queued-follow-up',
  resumeQueuedFollowUps: 'composer:resume-queued-follow-ups',
} as const

export function parseSessionRunStopRequest(
  value: unknown
): Readonly<{ sessionId: SessionMessageSubmission['sessionId'] }> | undefined {
  if (typeof value !== 'object' || value === null) return undefined

  const id = (value as Record<string, unknown>).sessionId

  return isSessionId(id) ? { sessionId: id } : undefined
}

export function parseQueuedFollowUpRemovalRequest(
  value: unknown
): Readonly<{ sessionId: SessionMessageSubmission['sessionId']; followUpId: string }> | undefined {
  if (typeof value !== 'object' || value === null) return undefined

  const request = value as Record<string, unknown>

  return isSessionId(request.sessionId) && typeof request.followUpId === 'string' && request.followUpId.length > 0
    ? { sessionId: request.sessionId, followUpId: request.followUpId }
    : undefined
}

export function parseSessionMessageSubmission(value: unknown): SessionMessageSubmission | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined
  }

  const submission = value as Record<string, unknown>
  const id = submission.sessionId

  if (
    !isSessionId(id) ||
    typeof submission.text !== 'string' ||
    submission.text.trim().length === 0 ||
    submission.text.length > maximumSessionMessageLength ||
    !sessionMessageDeliveries.some((delivery) => delivery === submission.delivery)
  ) {
    return undefined
  }

  return {
    sessionId: id,
    text: submission.text,
    delivery: submission.delivery as SessionMessageSubmission['delivery'],
  }
}
