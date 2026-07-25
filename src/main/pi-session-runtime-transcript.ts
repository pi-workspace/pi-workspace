import type { ActivityLayerRecord } from '@/src/main/activity-records'
import type { AgentActivity, AgentRun, SessionTimelineEntry, ToolExecution } from '@/src/session-timeline'
import type { SessionContextUsage, SessionTranscriptMessage } from '@/src/session-transcript'
import type { PiSessionRuntime, PiSessionRuntimeHistory } from './pi-session-runtimes'

export type SessionRuntimeTimeline = {
  revision: number
  runtimeDirectory?: string
  contextUsage?: SessionContextUsage
  isCompacting: boolean
  runs: AgentRun[]
  entries: SessionTimelineEntry[]
  messages: Map<string, SessionTranscriptMessage>
  currentActivityId?: string
  activities: Map<string, SessionRuntimeActivity>
  operations: Map<string, SessionRuntimeOperation>
  controlTransitions: Map<string, SessionRuntimeActivityControlTransition>
  persist?: (record: ActivityLayerRecord) => void
  loadRawOperation?: PiSessionRuntime['loadRawOperation']
}

export type SessionRuntimeActivity = {
  activity: AgentActivity
  pendingOperationIds: Set<string>
  closingRequested: boolean
  published: boolean
  closingSummary?: string
}

export type SessionRuntimeOperation = {
  execution: ToolExecution
  result?: unknown
}

export type SessionRuntimeActivityControlTransition = Readonly<{
  type: 'start' | 'complete'
  activityId?: string
  previousActivity?: AgentActivity
  summary?: string
  accepted?: boolean
}>

export function persistActivityRecord(timeline: SessionRuntimeTimeline, record: ActivityLayerRecord): boolean {
  if (!timeline.persist) return false

  try {
    timeline.persist(record)
    return true
  } catch (error) {
    console.error('Unable to persist an activity-record transition.', error)
    return false
  }
}

export function operationRecord(execution: ToolExecution): Omit<ToolExecution, 'input'> {
  return {
    toolCallId: execution.toolCallId,
    activityId: execution.activityId,
    toolName: execution.toolName,
    label: execution.label,
    status: execution.status,
    rawResultReference: execution.rawResultReference,
    inputPreview: execution.inputPreview,
  }
}

export function hydrateTimeline(timeline: SessionRuntimeTimeline, history: PiSessionRuntimeHistory | undefined): void {
  if (!history || timeline.entries.length > 0 || timeline.runs.length > 0) return

  const runs = new Map<string, AgentRun>()
  const activities = new Map<string, AgentActivity>()
  const operations = new Map<string, Omit<ToolExecution, 'input'>>()

  for (const record of history.activityRecords) {
    if (record.type === 'run') runs.set(record.run.id, record.run)
    if (record.type === 'activity') activities.set(record.activity.id, record.activity)
    if (record.type === 'operation') operations.set(record.execution.toolCallId, record.execution)
    if (record.type === 'activity-removed') activities.delete(record.activityId)
  }

  timeline.runs = [...runs.values()].sort((left, right) => left.startedAt - right.startedAt)

  const steeringMessageIds = new Set<string>()
  const unmatchedConversations = [...history.conversations]

  for (const record of history.activityRecords) {
    if (record.type !== 'steering-message') continue

    let index = -1
    let nearestTimestampDifference = Number.POSITIVE_INFINITY

    unmatchedConversations.forEach((conversation, candidateIndex) => {
      const timestampDifference = Math.abs(conversation.timestamp - record.acceptedAt)
      const matches = conversation.role === 'user' && conversation.text === record.text && timestampDifference <= 5_000

      if (matches && timestampDifference < nearestTimestampDifference) {
        index = candidateIndex
        nearestTimestampDifference = timestampDifference
      }
    })

    if (index < 0) continue

    const [conversation] = unmatchedConversations.splice(index, 1)
    if (conversation) steeringMessageIds.add(conversation.id)
  }

  for (const conversation of history.conversations) {
    timeline.messages.set(conversation.id, {
      id: conversation.id,
      role: conversation.role,
      text: conversation.text,
      skills: conversation.skills,
      delivery: steeringMessageIds.has(conversation.id) ? 'steer' : undefined,
      state: 'complete',
      revision: 0,
    })
  }

  const conversations = history.conversations.map((conversation) => {
    const ownerIndex = timeline.runs.findLastIndex((run) => run.startedAt <= conversation.timestamp + 1_000)
    const owner = ownerIndex >= 0 ? timeline.runs[ownerIndex] : undefined

    return owner ? { ...conversation, runId: owner.id } : conversation
  })

  timeline.runs = timeline.runs.map((run) => {
    const initiatingMessage = conversations.find(
      (entry) => entry.runId === run.id && entry.role === 'user' && entry.timestamp >= run.startedAt - 1_000
    )

    return initiatingMessage ? { ...run, initiatingMessageId: initiatingMessage.id } : run
  })

  for (const activity of activities.values()) {
    timeline.activities.set(activity.id, {
      activity,
      pendingOperationIds: new Set(),
      closingRequested: false,
      published: true,
    })
  }

  for (const execution of operations.values()) {
    timeline.operations.set(execution.toolCallId, { execution: { ...execution, input: undefined } })
  }

  timeline.entries = [...conversations, ...activities.values(), ...(history.compactions ?? [])].sort(
    (left, right) =>
      (left.type === 'conversation' || left.type === 'context-compaction' ? left.timestamp : left.startedAt) -
      (right.type === 'conversation' || right.type === 'context-compaction' ? right.timestamp : right.startedAt)
  )
  timeline.revision = history.activityRecords.length

  const running = timeline.runs.find((run) => run.status === 'running')
  if (!running) return

  const runStatus =
    history.finalState === 'completed' ? 'completed' : history.finalState === 'failed' ? 'failed' : 'cancelled'
  const activityStatus = runStatus === 'completed' ? 'completed' : runStatus === 'failed' ? 'failed' : 'blocked'
  const completedAt = Date.now()

  for (const activityId of running.activityIds) {
    const state = timeline.activities.get(activityId)
    if (!state || (state.activity.status !== 'running' && state.activity.status !== 'pending')) continue

    const activity = { ...state.activity, status: activityStatus, completedAt } as AgentActivity
    state.activity = activity

    const index = timeline.entries.findIndex((entry) => entry.type === 'activity' && entry.id === activity.id)
    if (index >= 0) timeline.entries[index] = activity
    persistActivityRecord(timeline, { version: 1, type: 'activity', activity })
  }

  const repairedRun = { ...running, status: runStatus, completedAt } as AgentRun
  const runIndex = timeline.runs.findIndex((run) => run.id === running.id)
  timeline.runs[runIndex] = repairedRun
  persistActivityRecord(timeline, { version: 1, type: 'run', run: repairedRun })
  persistActivityRecord(timeline, { version: 1, type: 'repair', runId: running.id, outcome: runStatus })
  timeline.revision += 1
}

export function safeDetailText(value: unknown): { text: string; truncated: boolean } {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  const text = serialized ?? String(value)
  const limit = 12_000
  return text.length > limit ? { text: `${text.slice(0, limit)}\n…`, truncated: true } : { text, truncated: false }
}
