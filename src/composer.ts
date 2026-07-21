import type { SessionId } from '@/src/domain/session'

export const sessionMessageDeliveries = ['steer', 'follow-up'] as const

export type SessionMessageDelivery = (typeof sessionMessageDeliveries)[number]

export type SessionMessageSubmission = Readonly<{
  sessionId: SessionId
  text: string
  delivery: SessionMessageDelivery
}>

export type AcceptedSessionMessageDelivery = 'prompt' | SessionMessageDelivery

export type SessionRunStopResult = Readonly<{ status: 'stopped' | 'not-running' }>

export const sessionMessageRejectionReasons = [
  'invalid-submission',
  'session-unavailable',
  'run-in-progress',
  'agent-run-capacity',
  'follow-up-capacity',
  'runtime-unavailable',
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
}
