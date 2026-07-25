import type { SessionId } from '@/src/domain/session'
import type { QueuedFollowUp } from '@/src/queued-follow-up'
import type { SessionSkillMention } from '@/src/session-skills'

const allowedExternalUrlProtocols = new Set(['http:', 'https:', 'mailto:'])
export const maximumExternalUrlLength = 8_192
import type { AgentActivity, AgentRun, AgentActivityDetails, SessionWorkingStateSnapshot } from '@/src/session-timeline'

export function isAllowedExternalUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > maximumExternalUrlLength) return false

  try {
    return allowedExternalUrlProtocols.has(new URL(value).protocol)
  } catch {
    return false
  }
}

export type SessionTranscriptMessage = Readonly<{
  id: string
  role: 'user' | 'assistant'
  text: string
  skills?: readonly SessionSkillMention[]
  delivery?: 'steer'
  state: 'complete' | 'streaming'
  revision: number
}>

export type SessionTranscriptEntry =
  | Readonly<{ type: 'message'; message: SessionTranscriptMessage }>
  | Readonly<{ type: 'activity'; activity: AgentActivity }>

export type SessionContextUsage = Readonly<{
  tokens: number | null
  contextWindow: number
  percent: number | null
}>

export type SessionTranscriptSnapshot = Readonly<{
  sessionId: SessionId
  revision: number
  isWorking: boolean
  contextUsage?: SessionContextUsage
  runs: readonly AgentRun[]
  entries: readonly SessionTranscriptEntry[]
  queuedFollowUps?: readonly QueuedFollowUp[]
  queuedFollowUpsPaused?: boolean
  runFailureReason?: 'failed' | 'cancelled'
}>

export type SessionTranscriptMutation = Readonly<{
  sessionId: SessionId
  revision: number
  snapshot: SessionTranscriptSnapshot
  announcement?: string
}>

export interface SessionTranscriptBridge {
  getSnapshot(sessionId: SessionId): Promise<SessionTranscriptSnapshot>
  getWorkingStateSnapshots(): Promise<readonly SessionWorkingStateSnapshot[]>
  loadActivityDetails(sessionId: SessionId, activityId: string): Promise<AgentActivityDetails | undefined>
  openExternalLink(url: string): Promise<void>
  subscribe(listener: (mutation: SessionTranscriptMutation) => void): () => void
}
