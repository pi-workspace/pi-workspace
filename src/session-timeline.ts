import type { SessionId } from '@/src/domain/session'
import type { SessionSkillMention } from '@/src/session-skills'

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
export type ToolExecutionCommandTermination =
  'exited' | 'exit-code' | 'signaled' | 'memory-limit' | 'timeout' | 'aborted' | 'isolation-failure'

export type ToolExecutionCommandOutcome = Readonly<{
  termination: ToolExecutionCommandTermination
  peakMemoryBytes: number
  exitCode?: number
  signal?: string
}>

export type ConversationEntry = Readonly<{
  type: 'conversation'
  id: string
  runId?: string
  role: 'user' | 'assistant'
  text: string
  skills?: readonly SessionSkillMention[]
  timestamp: number
}>

export type InspectedFileArtifact = Readonly<{
  type: 'inspected-file'
  path: string
}>

export type FileChangeArtifact = Readonly<{
  type: 'file-change'
  path: string
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
  commandOutcome?: ToolExecutionCommandOutcome
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

export type SessionTimelineEntry = ConversationEntry | AgentActivity

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

export type ActivityOperationDetail = Readonly<{
  toolCallId: string
  label: string
  status: ToolExecutionStatus
  inputPreview?: string
  input: string
  output?: string
  truncated: boolean
  commandOutcome?: ToolExecutionCommandOutcome
}>

export type AgentActivityDetails = Readonly<{
  activityId: string
  operations: readonly ActivityOperationDetail[]
}>
