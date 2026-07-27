import type { SessionId } from '@/src/domain/session'
import type { SessionSkillMention } from '@/src/session-skills'
import type { SessionCodeReview } from '@/src/session-code-review'
import type { SessionFileMention } from '@/src/session-files'

export const agentActivityKinds = [
  'exploration',
  'research',
  'planning',
  'implementation',
  'validation',
  'review',
] as const

export type AgentActivityKind = (typeof agentActivityKinds)[number] | 'other'
export type AgentRunStatus = 'running' | 'completed' | 'failed' | 'cancelled'
export type AgentActivityStatus = 'pending' | 'running' | 'completed' | 'failed' | 'blocked'
export type ToolExecutionStatus = 'running' | 'completed' | 'failed'

export type ConversationEntry = Readonly<{
  type: 'conversation'
  id: string
  runId?: string
  role: 'user' | 'assistant'
  text: string
  skills?: readonly SessionSkillMention[]
  files?: readonly SessionFileMention[]
  codeReview?: SessionCodeReview
  delivery?: 'steer'
  timestamp: number
}>

export type InspectedFileArtifact = Readonly<{
  type: 'inspected-file'
  path: string
}>

export type FileChangeArtifact = Readonly<{
  type: 'file-change'
  path: string
  repositoryId?: string
  additions?: number
  deletions?: number
}>

export type CommandArtifact = Readonly<{
  type: 'command'
  command: string
  status: 'completed' | 'failed'
  rawResultReference?: string
}>

export type ValidationArtifact = Readonly<{
  type: 'validation'
  label: string
  status: 'completed' | 'failed'
  passed?: number
  failed?: number
  skipped?: number
}>

export type ActivityArtifact = InspectedFileArtifact | FileChangeArtifact | CommandArtifact | ValidationArtifact

export type ToolExecution = Readonly<{
  toolCallId: string
  activityId: string
  toolName: string
  label: string
  status: ToolExecutionStatus
  input: unknown
  rawResultReference?: string
  inputPreview?: string
}>

export type AgentActivity = Readonly<{
  type: 'activity'
  id: string
  runId: string
  kind: AgentActivityKind
  title: string
  expectedOutcome?: string
  summary?: string
  status: AgentActivityStatus
  operationCount: number
  fileCount: number
  secondaryLine?: string
  artifacts: readonly ActivityArtifact[]
  startedAt: number
  completedAt?: number
}>

export type ContextCompaction = Readonly<{
  type: 'context-compaction'
  id: string
  summary: string
  timestamp: number
}>

export type SessionTimelineEntry = ConversationEntry | AgentActivity | ContextCompaction

export type AgentRun = Readonly<{
  id: string
  initiatingMessageId: string
  status: AgentRunStatus
  activityIds: readonly string[]
  startedAt: number
  completedAt?: number
}>

export type SessionWorkingStateSnapshot = Readonly<{
  sessionId: SessionId
  revision: number
  isWorking: boolean
}>

export type ActivityMutationPreview = Readonly<{
  kind: 'diff' | 'code'
  path: string
  repositoryId?: string
  content: string
  truncated: boolean
}>

export type ActivityOperationDetail = Readonly<{
  toolCallId: string
  label: string
  status: ToolExecutionStatus
  inputPreview?: string
  input: string
  output?: string
  preview?: ActivityMutationPreview
  truncated: boolean
}>

export type AgentActivityDetails = Readonly<{
  activityId: string
  operations: readonly ActivityOperationDetail[]
}>
