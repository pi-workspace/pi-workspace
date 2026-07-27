import type { SessionId } from '@/src/domain/session'
import type { QueuedFollowUp } from '@/src/queued-follow-up'
import type { SessionSkillMention } from '@/src/session-skills'
import type { SessionActionCard } from '@/src/session-action-cards'
import type { SessionCodeReview } from '@/src/session-code-review'
import type { SessionFileMention } from '@/src/session-files'

const allowedExternalUrlProtocols = new Set(['http:', 'https:', 'mailto:'])
export const maximumExternalUrlLength = 8_192
import type {
  AgentActivity,
  AgentRun,
  AgentActivityDetails,
  ContextCompaction,
  SessionWorkingStateSnapshot,
} from '@/src/session-timeline'

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
  files?: readonly SessionFileMention[]
  codeReview?: SessionCodeReview
  delivery?: 'steer'
  state: 'complete' | 'streaming'
  revision: number
}>

export type SessionTranscriptEntry =
  | Readonly<{ type: 'message'; message: SessionTranscriptMessage }>
  | Readonly<{ type: 'activity'; activity: AgentActivity }>
  | Readonly<{ type: 'compaction'; compaction: ContextCompaction }>

export type SessionContextUsage = Readonly<{
  tokens: number | null
  contextWindow: number
  percent: number | null
  canCompact?: boolean
}>

export type SessionTranscriptSnapshot = Readonly<{
  sessionId: SessionId
  revision: number
  isWorking: boolean
  isCompacting?: boolean
  contextUsage?: SessionContextUsage
  runs: readonly AgentRun[]
  entries: readonly SessionTranscriptEntry[]
  actionCards?: readonly SessionActionCard[]
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
  acceptActionCard(sessionId: SessionId, actionCardId: string): Promise<boolean>
  openExternalLink(url: string): Promise<void>
  subscribe(listener: (mutation: SessionTranscriptMutation) => void): () => void
}
