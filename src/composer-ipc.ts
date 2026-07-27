import {
  sessionMessageDeliveries,
  type SessionCodeReviewCommentCommand,
  type SessionMessageSubmission,
} from '@/src/composer'
import {
  formatSessionCodeReviewText,
  parseSessionCodeReview,
  parseSessionCodeReviewCommentInput,
} from '@/src/session-code-review'
import { isSessionId } from '@/src/domain/session'

/** Session messages are bounded to limit retained IPC and provider work per submission. */
export const maximumSessionMessageLength = 200_000

export const composerIpcChannels = {
  compact: 'composer:compact',
  submit: 'composer:submit',
  getCodeReviewDraft: 'composer:get-code-review-draft',
  saveCodeReviewComment: 'composer:save-code-review-comment',
  removeCodeReviewComment: 'composer:remove-code-review-comment',
  finishCodeReview: 'composer:finish-code-review',
  stop: 'composer:stop',
  removeQueuedFollowUp: 'composer:remove-queued-follow-up',
  resumeQueuedFollowUps: 'composer:resume-queued-follow-ups',
} as const

export function parseSessionCompactRequest(
  value: unknown
): Readonly<{ sessionId: SessionMessageSubmission['sessionId'] }> | undefined {
  return parseSessionRunStopRequest(value)
}

export function parseSessionRunStopRequest(
  value: unknown
): Readonly<{ sessionId: SessionMessageSubmission['sessionId'] }> | undefined {
  if (typeof value !== 'object' || value === null) return undefined

  const id = (value as Record<string, unknown>).sessionId

  return isSessionId(id) ? { sessionId: id } : undefined
}

export function parseCodeReviewCommentCommand(value: unknown): SessionCodeReviewCommentCommand | undefined {
  if (typeof value !== 'object' || value === null) return undefined

  const command = value as Record<string, unknown>
  const input = parseSessionCodeReviewCommentInput(command)

  return isSessionId(command.sessionId) && input ? { sessionId: command.sessionId, ...input } : undefined
}

export function parseCodeReviewCommentRemovalRequest(
  value: unknown
): Readonly<{ sessionId: SessionMessageSubmission['sessionId']; commentId: string }> | undefined {
  if (typeof value !== 'object' || value === null) return undefined

  const request = value as Record<string, unknown>

  return isSessionId(request.sessionId) && typeof request.commentId === 'string' && request.commentId.length > 0
    ? { sessionId: request.sessionId, commentId: request.commentId }
    : undefined
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
  const codeReview = submission.codeReview === undefined ? undefined : parseSessionCodeReview(submission.codeReview)
  const text = codeReview ? formatSessionCodeReviewText(codeReview) : submission.text

  if (
    !isSessionId(id) ||
    (submission.codeReview !== undefined && !codeReview) ||
    typeof text !== 'string' ||
    text.trim().length === 0 ||
    text.length > maximumSessionMessageLength ||
    !sessionMessageDeliveries.some((delivery) => delivery === submission.delivery) ||
    (codeReview !== undefined && submission.delivery !== 'follow-up')
  ) {
    return undefined
  }

  return {
    sessionId: id,
    text,
    delivery: submission.delivery as SessionMessageSubmission['delivery'],
    ...(codeReview ? { codeReview } : {}),
  }
}
