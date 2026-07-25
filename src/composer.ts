import type { SessionId } from '@/src/domain/session'

export const sessionMessageDeliveries = ['steer', 'follow-up', 'action'] as const

export type SessionMessageDelivery = (typeof sessionMessageDeliveries)[number]

export const maximumSessionSkillNameLength = 64
const sessionSkillNamePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export type SessionMessageSubmission = Readonly<{
  sessionId: SessionId
  text: string
  delivery: SessionMessageDelivery
}>

export function isSessionSkillName(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maximumSessionSkillNameLength &&
    sessionSkillNamePattern.test(value)
  )
}

export type AcceptedSessionMessageDelivery = 'prompt' | SessionMessageDelivery

export type SessionRunStopResult = Readonly<{ status: 'stopped' | 'not-running' }>

export const sessionMessageRejectionReasons = [
  'invalid-submission',
  'session-unavailable',
  'run-in-progress',
  'agent-run-capacity',
  'follow-up-capacity',
  'runtime-unavailable',
  'skill-unavailable',
  'preflight-rejected',
  'unexpected',
] as const

export type SessionMessageRejectionReason = (typeof sessionMessageRejectionReasons)[number]

export type SessionMessageSubmissionResult =
  | Readonly<{
      status: 'accepted'
      delivery: AcceptedSessionMessageDelivery
    }>
  | Readonly<{
      status: 'rejected'
      reason: SessionMessageRejectionReason
    }>

export interface ComposerBridge {
  submit(submission: SessionMessageSubmission): Promise<SessionMessageSubmissionResult>
  stop(sessionId: SessionId): Promise<SessionRunStopResult>
  removeQueuedFollowUp(sessionId: SessionId, followUpId: string): Promise<boolean>
  resumeQueuedFollowUps(sessionId: SessionId): Promise<boolean>
}
