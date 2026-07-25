import type { QueuedFollowUp, QueuedFollowUpRecord } from '@/src/queued-follow-up'
import type { SessionActionCard, SessionActionCardStatus } from '@/src/session-action-cards'
import {
  agentActivityKinds,
  type ActivityArtifact,
  type AgentActivity,
  type AgentRun,
  type ToolExecution,
} from '@/src/session-timeline'

export const agentRunDiagnosticKinds = [
  'runtime-cancellation',
  'stale-authority',
  'provider-failure',
  'no-progress-timeout',
] as const

export type AgentRunDiagnosticKind = (typeof agentRunDiagnosticKinds)[number]

export const activityLayerCustomEntryType = 'pi-workspace.activity-layer'

export type ActivityLayerRecord =
  | Readonly<{ version: 1; type: 'run'; run: AgentRun }>
  | Readonly<{ version: 1; type: 'activity'; activity: AgentActivity }>
  | Readonly<{
      version: 1
      type: 'operation'
      execution: Omit<ToolExecution, 'input'>
    }>
  | Readonly<{ version: 1; type: 'activity-removed'; activityId: string }>
  | Readonly<{ version: 1; type: 'action-card'; card: SessionActionCard }>
  | Readonly<{
      version: 1
      type: 'action-card-status'
      actionCardId: string
      status: Exclude<SessionActionCardStatus, 'available'>
    }>
  | Readonly<{ version: 1 } & QueuedFollowUpRecord>
  | Readonly<{ version: 1; type: 'steering-message'; text: string; acceptedAt: number }>
  | Readonly<{ version: 1; type: 'action-message'; text: string; acceptedAt: number }>
  | Readonly<{
      version: 1
      type: 'diagnostic'
      runId: string
      kind: AgentRunDiagnosticKind
      explanation: string
    }>
  | Readonly<{ version: 1; type: 'repair'; runId: string; outcome: 'completed' | 'failed' | 'cancelled' }>

export function isActivityLayerRecord(value: unknown): value is ActivityLayerRecord {
  if (!isRecord(value) || value.version !== 1) return false

  if (value.type === 'run') return isAgentRun(value.run)
  if (value.type === 'activity') return isAgentActivity(value.activity)
  if (value.type === 'operation') return isToolExecution(value.execution)
  if (value.type === 'activity-removed') return isNonEmptyString(value.activityId)
  if (value.type === 'action-card') return isSessionActionCard(value.card)
  if (value.type === 'action-card-status') {
    return isNonEmptyString(value.actionCardId) && (value.status === 'accepted' || value.status === 'dismissed')
  }
  if (value.type === 'queued-follow-up') return isQueuedFollowUp(value.followUp)
  if (value.type === 'queued-follow-up-removed') return isNonEmptyString(value.followUpId)
  if (value.type === 'steering-message' || value.type === 'action-message') {
    return typeof value.text === 'string' && isTimestamp(value.acceptedAt)
  }
  if (value.type === 'diagnostic') {
    return (
      isNonEmptyString(value.runId) &&
      agentRunDiagnosticKinds.includes(value.kind as AgentRunDiagnosticKind) &&
      typeof value.explanation === 'string'
    )
  }
  if (value.type === 'repair') {
    return (
      isNonEmptyString(value.runId) &&
      (value.outcome === 'completed' || value.outcome === 'failed' || value.outcome === 'cancelled')
    )
  }

  return false
}

function isSessionActionCard(value: unknown): value is SessionActionCard {
  if (!isRecord(value)) return false

  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.sessionId) &&
    (value.kind === 'start-implement-session' || value.kind === 'prepare-pull-request') &&
    isNonEmptyString(value.title) &&
    isNonEmptyString(value.description) &&
    value.status === 'available' &&
    isTimestamp(value.createdAt)
  )
}

function isQueuedFollowUp(value: unknown): value is QueuedFollowUp {
  if (!isRecord(value)) return false

  return (
    isNonEmptyString(value.id) &&
    typeof value.text === 'string' &&
    (value.sourceText === undefined || typeof value.sourceText === 'string') &&
    (value.skills === undefined || (Array.isArray(value.skills) && value.skills.every(isSessionSkillMention))) &&
    (value.files === undefined || (Array.isArray(value.files) && value.files.every(isSessionFileMention))) &&
    isTimestamp(value.createdAt)
  )
}

function isSessionSkillMention(value: unknown): boolean {
  if (!isRecord(value) || !isCount(value.offset) || !isRecord(value.skill) || !isNonEmptyString(value.skill.name)) {
    return false
  }

  return (
    (value.skill.availability === 'available' && typeof value.skill.description === 'string') ||
    value.skill.availability === 'unavailable'
  )
}

function isSessionFileMention(value: unknown): boolean {
  if (!isRecord(value) || !isCount(value.offset) || !isRecord(value.file) || !isNonEmptyString(value.file.path)) {
    return false
  }

  return (
    (value.file.kind === 'file' || value.file.kind === 'folder') &&
    (value.file.availability === 'available' || value.file.availability === 'unavailable')
  )
}

function isAgentRun(value: unknown): value is AgentRun {
  if (!isRecord(value)) return false

  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.initiatingMessageId) &&
    (value.status === 'running' ||
      value.status === 'completed' ||
      value.status === 'failed' ||
      value.status === 'cancelled') &&
    Array.isArray(value.activityIds) &&
    value.activityIds.every(isNonEmptyString) &&
    isTimestamp(value.startedAt) &&
    (value.completedAt === undefined || isTimestamp(value.completedAt))
  )
}

function isAgentActivity(value: unknown): value is AgentActivity {
  if (!isRecord(value)) return false

  return (
    value.type === 'activity' &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.runId) &&
    (agentActivityKinds.includes(value.kind as (typeof agentActivityKinds)[number]) || value.kind === 'other') &&
    isNonEmptyString(value.title) &&
    isOptionalString(value.expectedOutcome) &&
    isOptionalString(value.summary) &&
    (value.status === 'pending' ||
      value.status === 'running' ||
      value.status === 'completed' ||
      value.status === 'failed' ||
      value.status === 'blocked') &&
    isCount(value.operationCount) &&
    isCount(value.fileCount) &&
    isOptionalString(value.secondaryLine) &&
    Array.isArray(value.artifacts) &&
    value.artifacts.every(isActivityArtifact) &&
    isTimestamp(value.startedAt) &&
    (value.completedAt === undefined || isTimestamp(value.completedAt))
  )
}

function isToolExecution(value: unknown): value is Omit<ToolExecution, 'input'> {
  if (!isRecord(value)) return false

  return (
    isNonEmptyString(value.toolCallId) &&
    isNonEmptyString(value.activityId) &&
    isNonEmptyString(value.toolName) &&
    isNonEmptyString(value.label) &&
    (value.status === 'running' || value.status === 'completed' || value.status === 'failed') &&
    isOptionalString(value.rawResultReference) &&
    isOptionalString(value.inputPreview)
  )
}

function isActivityArtifact(value: unknown): value is ActivityArtifact {
  if (!isRecord(value)) return false

  if (value.type === 'inspected-file') return isNonEmptyString(value.path)
  if (value.type === 'file-change') {
    return (
      isNonEmptyString(value.path) &&
      (value.additions === undefined || isCount(value.additions)) &&
      (value.deletions === undefined || isCount(value.deletions))
    )
  }
  if (value.type === 'command') {
    return (
      isNonEmptyString(value.command) &&
      (value.status === 'completed' || value.status === 'failed') &&
      isOptionalString(value.rawResultReference)
    )
  }
  if (value.type === 'validation') {
    return (
      isNonEmptyString(value.label) &&
      (value.status === 'completed' || value.status === 'failed') &&
      (value.passed === undefined || isCount(value.passed)) &&
      (value.failed === undefined || isCount(value.failed)) &&
      (value.skipped === undefined || isCount(value.skipped))
    )
  }

  return false
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string'
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function isTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}
