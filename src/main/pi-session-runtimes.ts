import type {
  AcceptedSessionMessageDelivery,
  SessionMessageSubmission,
  SessionMessageSubmissionResult,
  SessionContextCompactionResult,
  SessionRunStopResult,
} from '@/src/composer'
import type { ManagedSessionRuntimePolicy } from '@/src/domain/managed-session'
import type { SessionId } from '@/src/domain/session'
import type { SessionActionCardToolInput } from '@/src/session-action-cards'
import {
  projectSessionSkillSelections,
  replaceSessionSkillTokens,
  type SessionSkill,
  type SessionSkillMention,
} from '@/src/session-skills'
import type { ActivityLayerRecord, AgentRunDiagnosticKind } from '@/src/main/activity-records'
import {
  countArtifactFiles,
  deriveActivityArtifacts,
  deriveMutationPreview,
  deriveOperationInputPreview,
  mergeActivityArtifacts,
} from '@/src/main/activity-artifacts'
import {
  agentActivityKinds,
  type AgentActivity,
  type AgentActivityDetails,
  type AgentActivityKind,
  type AgentRun,
  type ContextCompaction,
  type ConversationEntry,
  type SessionWorkingStateSnapshot,
  type ToolExecution,
} from '@/src/session-timeline'
import type {
  SessionContextUsage,
  SessionTranscriptEntry,
  SessionTranscriptMessage,
  SessionTranscriptMutation,
  SessionTranscriptSnapshot,
} from '@/src/session-transcript'
import type {
  SessionConfigurationCommandResult,
  SessionConfigurationEffort,
  SessionConfigurationModelSelection,
  SessionConfigurationMutation,
  SessionConfigurationSnapshot,
} from '@/src/session-configuration'
import { createQueuedFollowUpQueue } from './queued-follow-up-queue'
import { createSessionRuntimeActivationGate } from './pi-session-runtime-activation'
import { createSessionRuntimeLifecycle, type SessionRuntimeEntry } from './pi-session-runtime-lifecycle'
import {
  hydrateTimeline,
  operationRecord,
  persistActivityRecord,
  safeDetailText,
  type SessionRuntimeActivity,
  type SessionRuntimeTimeline,
} from './pi-session-runtime-transcript'
import { createSessionRuntimeConfiguration } from './pi-session-runtime-configuration'

type PiPromptOptions = Readonly<{
  streamingBehavior?: 'steer' | 'followUp'
  preflightResult: (accepted: boolean) => void
}>

export interface PiSessionRuntime {
  readonly isStreaming: boolean
  prompt(text: string, options: PiPromptOptions): Promise<void>
  rename?(title: string): void
  subscribe(listener: (event: PiSessionRuntimeEvent) => void): () => void
  abort?(): Promise<void>
  compact?(): Promise<void>
  canCompact?(): boolean
  loadHistory?(): PiSessionRuntimeHistory
  appendActivityRecord?(record: ActivityLayerRecord): void
  loadRawOperation?(toolCallId: string): Readonly<{ input: unknown; result?: unknown }> | undefined
  getActivityRepositoryLocations?(): readonly Readonly<{ repositoryId: string; workingPath: string }>[]
  getSkills?(): readonly SessionSkill[]
  getSkillPrompt?(name: string): string | undefined
  getContextUsage?(): SessionContextUsage | undefined
  getConfiguration?(): Promise<Omit<SessionConfigurationSnapshot, 'sessionId' | 'revision' | 'persistenceWarning'>>
  setConfigurationModel?(model: SessionConfigurationModelSelection): Promise<void>
  setConfigurationEffort?(effort: SessionConfigurationEffort): Promise<void>
  flushConfiguration?(): Promise<readonly string[]>
  dispose(): void
}

export type PiSessionRuntimeHistory = Readonly<{
  conversations: readonly ConversationEntry[]
  activityRecords: readonly ActivityLayerRecord[]
  compactions?: readonly ContextCompaction[]
  finalState: 'completed' | 'failed' | 'cancelled' | 'indeterminate'
}>

export type PiSessionRuntimeEvent =
  | Readonly<{ type: 'context_usage'; usage?: SessionContextUsage }>
  | Readonly<{ type: 'compaction_completed'; summary: string }>
  | Readonly<{ type: 'tool_execution_start'; toolCallId: string; toolName: string; input: unknown }>
  | Readonly<{
      type: 'activity_control_accepted'
      toolCallId: string
      toolName: 'start_activity' | 'complete_activity'
    }>
  | Readonly<{ type: 'action_card_created'; input: SessionActionCardToolInput; createdAt: number }>
  | Readonly<{
      type: 'tool_execution_end'
      toolCallId: string
      toolName: string
      result: unknown
      isError: boolean
      rawResultReference?: string
    }>
  | Readonly<{ type: 'message_upsert'; message: SessionTranscriptMessage }>
  | Readonly<{ type: 'model_turn_started'; noProgressTimeoutMs: number }>
  | Readonly<{ type: 'model_turn_progress' }>
  | Readonly<{ type: 'agent_end' }>
  | Readonly<{ type: 'agent_settled' }>
  | Readonly<{ type: 'failed'; explanation: string; diagnosticKind?: AgentRunDiagnosticKind }>
  | Readonly<{ type: 'cancelled'; explanation: string; diagnosticKind?: AgentRunDiagnosticKind }>

export type PiSessionLocation = Readonly<{
  directoryPath: string
  sessionPath: string
  toolAccess?: 'none' | 'read-only' | 'full'
  managedPolicy?: ManagedSessionRuntimePolicy
  runtimeKey?: string
}>

type PiSessionRuntimeRegistryOptions = Readonly<{
  findSession: (sessionId: SessionId) => PiSessionLocation | undefined | Promise<PiSessionLocation | undefined>
  canSubmit?: (sessionId: SessionId) => boolean | Promise<boolean>
  createSession: (location: PiSessionLocation, sessionId: SessionId) => Promise<PiSessionRuntime>
  createId?: () => string
  now?: () => number
  reconcileAfterRun?: (sessionId: SessionId) => Promise<boolean>
  acquireRunLease?: (sessionId: SessionId) => boolean | Promise<boolean>
  releaseRunLease?: (sessionId: SessionId) => void | Promise<void>
  acquireCompactionLease?: (sessionId: SessionId) => boolean | Promise<boolean>
  releaseCompactionLease?: (sessionId: SessionId) => void | Promise<void>
  noProgressTimeoutMs?: number
  stopTimeoutMs?: number
}>

export interface PiSessionRuntimeRegistry {
  registerRuntime(
    sessionId: SessionId,
    runtimeDirectory: string,
    runtime: PiSessionRuntime,
    reconcileAfterRun?: () => Promise<boolean>
  ): void
  submit(submission: SessionMessageSubmission): Promise<SessionMessageSubmissionResult>
  stop(sessionId: SessionId): Promise<SessionRunStopResult>
  compact(sessionId: SessionId): Promise<SessionContextCompactionResult>
  removeQueuedFollowUp(sessionId: SessionId, followUpId: string): Promise<boolean>
  resumeQueuedFollowUps(sessionId: SessionId): Promise<boolean>
  acceptActionCard(sessionId: SessionId, actionCardId: string): Promise<boolean>
  renameSession(sessionId: SessionId, title: string): Promise<void>
  getWorkingStateSnapshots(): readonly SessionWorkingStateSnapshot[]
  loadActivityDetails(sessionId: SessionId, activityId: string): Promise<AgentActivityDetails | undefined>
  getTranscript(sessionId: SessionId): Promise<SessionTranscriptSnapshot>
  getAvailableSkills(sessionId: SessionId): Promise<readonly SessionSkill[]>
  subscribeTranscript(listener: (mutation: SessionTranscriptMutation) => void): () => void
  getConfigurationSnapshot(sessionId: SessionId): Promise<SessionConfigurationSnapshot>
  setConfigurationModel(
    sessionId: SessionId,
    model: SessionConfigurationModelSelection
  ): Promise<SessionConfigurationCommandResult>
  setConfigurationEffort(
    sessionId: SessionId,
    effort: SessionConfigurationEffort
  ): Promise<SessionConfigurationCommandResult>
  dismissConfigurationWarning(sessionId: SessionId): Promise<SessionConfigurationSnapshot>
  subscribeConfiguration(listener: (mutation: SessionConfigurationMutation) => void): () => void
  dispose(): void
}

const activityControlTools = new Set(['start_activity', 'complete_activity'])
const declaredActivityKinds = new Set<AgentActivityKind>(agentActivityKinds)

/** Bounds simultaneous provider-backed Agent Runs across the application. */
export const maximumConcurrentAgentRuns = 10
/** Preserves normal follow-up use while bounding queued future provider work per Session. */
export const maximumPendingSessionFollowUps = 3

export function createPiSessionRuntimeRegistry({
  findSession,
  canSubmit = () => true,
  createSession,
  createId = () => crypto.randomUUID(),
  now = Date.now,
  reconcileAfterRun,
  acquireRunLease = () => true,
  releaseRunLease = () => {},
  acquireCompactionLease = () => true,
  releaseCompactionLease = () => {},
  noProgressTimeoutMs = 30_000,
  stopTimeoutMs = 5_000,
}: PiSessionRuntimeRegistryOptions): PiSessionRuntimeRegistry {
  const timelineBySessionId = new Map<SessionId, SessionRuntimeTimeline>()
  const transcriptListeners = new Set<(mutation: SessionTranscriptMutation) => void>()
  const activationGate = createSessionRuntimeActivationGate()
  const activeAgentRunReservations = new Set<SessionId>()
  const queuedFollowUpQueue = createQueuedFollowUpQueue()
  const submissionQueuesBySessionId = new Map<SessionId, Promise<void>>()
  const sessionReconciliationBySessionId = new Map<SessionId, () => Promise<boolean>>()
  const noProgressTimeoutsBySessionId = new Map<SessionId, ReturnType<typeof setTimeout>>()
  const noProgressTimeoutDurationsBySessionId = new Map<SessionId, number>()
  const reconciliationPromisesBySessionId = new Map<SessionId, Promise<void>>()
  let nextAcceptedMessageId = 0

  function getTimeline(sessionId: SessionId): SessionRuntimeTimeline {
    let timeline = timelineBySessionId.get(sessionId)
    if (!timeline) {
      timeline = {
        revision: 0,
        runs: [],
        entries: [],
        actionCards: [],
        messages: new Map(),
        activities: new Map(),
        operations: new Map(),
        controlTransitions: new Map(),
        isCompacting: false,
      }

      timelineBySessionId.set(sessionId, timeline)
    }

    return timeline
  }

  function hydrateQueuedFollowUps(sessionId: SessionId, history: PiSessionRuntimeHistory | undefined): void {
    const records = (history?.activityRecords ?? []).flatMap((record) =>
      record.type === 'queued-follow-up' || record.type === 'queued-follow-up-removed' ? [record] : []
    )

    queuedFollowUpQueue.hydrate(sessionId, records)
  }

  function removeQueuedFollowUp(sessionId: SessionId, followUpId: string): boolean {
    const followUp = queuedFollowUpQueue.queuedFollowUps(sessionId).find((candidate) => candidate.id === followUpId)

    if (!followUp) return false

    const persisted = persistActivityRecord(getTimeline(sessionId), {
      version: 1,
      type: 'queued-follow-up-removed',
      followUpId,
    })

    if (!persisted) return false

    queuedFollowUpQueue.remove(sessionId, followUpId)
    publishTimeline(sessionId)
    return true
  }

  function acceptActionCard(sessionId: SessionId, actionCardId: string): boolean {
    const timeline = getTimeline(sessionId)
    const cardIndex = timeline.actionCards.findIndex(
      (card) => card.id === actionCardId && card.sessionId === sessionId && card.status === 'available'
    )

    if (cardIndex < 0) return false

    const card = timeline.actionCards[cardIndex]
    if (!card) return false

    const persisted = persistActivityRecord(timeline, {
      version: 1,
      type: 'action-card-status',
      actionCardId,
      status: 'accepted',
    })

    if (!persisted) return false

    timeline.actionCards[cardIndex] = { ...card, status: 'accepted' }
    publishTimeline(sessionId)
    return true
  }

  async function dispatchNextQueuedFollowUp(sessionId: SessionId): Promise<void> {
    if (activeRun(getTimeline(sessionId))) return

    const followUp = queuedFollowUpQueue.next(sessionId)

    if (!followUp) return

    const result = await submit({ sessionId, text: followUp.text, delivery: 'follow-up' })

    if (result.status === 'accepted' && result.delivery !== 'follow-up') {
      if (!removeQueuedFollowUp(sessionId, followUp.id)) {
        queuedFollowUpQueue.pause(sessionId)
        publishTimeline(sessionId, 'Queued follow-ups paused because the delivered follow-up could not be removed.')
      }

      return
    }

    queuedFollowUpQueue.pause(sessionId)
    publishTimeline(sessionId, 'Queued follow-ups paused because the next follow-up could not start.')
  }

  function publishTimeline(sessionId: SessionId, announcement?: string): void {
    const timeline = getTimeline(sessionId)
    timeline.revision += 1

    const nextSnapshot = transcriptSnapshot(sessionId)
    const mutation: SessionTranscriptMutation = {
      sessionId,
      revision: nextSnapshot.revision,
      snapshot: nextSnapshot,
      announcement,
    }

    transcriptListeners.forEach((listener) => listener(mutation))
  }

  function transcriptSnapshot(sessionId: SessionId): SessionTranscriptSnapshot {
    const timeline = getTimeline(sessionId)
    const messages = [...timeline.messages.values()]
    const messagesById = new Map(messages.map((message) => [message.id, message]))
    const representedMessageIds = new Set<string>()
    const entries: SessionTranscriptEntry[] = []

    timeline.entries.forEach((entry) => {
      if (entry.type === 'activity') {
        entries.push({ type: 'activity', activity: entry })
        return
      }
      if (entry.type === 'context-compaction') {
        entries.push({ type: 'compaction', compaction: entry })
        return
      }

      const message = messagesById.get(entry.id)
      if (!message) return

      representedMessageIds.add(message.id)
      entries.push({ type: 'message', message: transcriptMessage(message) })
    })

    for (const message of messages) {
      if (!representedMessageIds.has(message.id)) entries.push({ type: 'message', message: transcriptMessage(message) })
    }

    const latestRun = timeline.runs.at(-1)

    return {
      sessionId,
      revision: timeline.revision,
      isWorking: timeline.runs.some((run) => run.status === 'running'),
      isCompacting: timeline.isCompacting,
      contextUsage: timeline.contextUsage,
      runs: timeline.runs,
      entries,
      actionCards: timeline.actionCards,
      queuedFollowUps: queuedFollowUpQueue.queuedFollowUps(sessionId),
      queuedFollowUpsPaused: queuedFollowUpQueue.isPaused(sessionId),
      runFailureReason:
        latestRun?.status === 'failed' || latestRun?.status === 'cancelled' ? latestRun.status : undefined,
    }
  }

  function activeRun(timeline: SessionRuntimeTimeline): AgentRun | undefined {
    return timeline.runs.find((run) => run.status === 'running')
  }

  function clearNoProgressTimeout(sessionId: SessionId): void {
    const timeout = noProgressTimeoutsBySessionId.get(sessionId)

    if (timeout) clearTimeout(timeout)
    noProgressTimeoutsBySessionId.delete(sessionId)
    noProgressTimeoutDurationsBySessionId.delete(sessionId)
  }

  function armNoProgressTimeout(
    sessionId: SessionId,
    timeline: SessionRuntimeTimeline,
    timeoutMs = noProgressTimeoutMs
  ): void {
    clearNoProgressTimeout(sessionId)

    if (!activeRun(timeline)) return
    if ([...timeline.operations.values()].some(({ execution }) => execution.status === 'running')) return

    const timeout = setTimeout(() => {
      if (noProgressTimeoutsBySessionId.get(sessionId) !== timeout) return

      void failNoProgressingRun(sessionId, timeout)
    }, timeoutMs)

    timeout.unref?.()
    noProgressTimeoutsBySessionId.set(sessionId, timeout)
    noProgressTimeoutDurationsBySessionId.set(sessionId, timeoutMs)
  }

  async function failNoProgressingRun(sessionId: SessionId, timeout: ReturnType<typeof setTimeout>): Promise<void> {
    const timeline = getTimeline(sessionId)

    if (!activeRun(timeline) || noProgressTimeoutsBySessionId.get(sessionId) !== timeout) return

    const pendingEntry = lifecycle.getEntry(sessionId)

    if (pendingEntry) {
      await pendingEntry.catch(() => undefined)

      if (noProgressTimeoutsBySessionId.get(sessionId) !== timeout) return

      await lifecycle.retire(sessionId, pendingEntry)
    }

    noProgressTimeoutsBySessionId.delete(sessionId)
    noProgressTimeoutDurationsBySessionId.delete(sessionId)
    handleRuntimeEvent(sessionId, {
      type: 'failed',
      explanation: 'Pi stopped producing progress.',
      diagnosticKind: 'no-progress-timeout',
    })
  }

  function replaceRun(timeline: SessionRuntimeTimeline, run: AgentRun): void {
    const index = timeline.runs.findIndex((candidate) => candidate.id === run.id)
    if (index >= 0) timeline.runs[index] = run
  }

  function replaceActivity(timeline: SessionRuntimeTimeline, activity: AgentActivity): void {
    const index = timeline.entries.findIndex((entry) => entry.type === 'activity' && entry.id === activity.id)
    if (index >= 0) timeline.entries[index] = activity

    const state = timeline.activities.get(activity.id)
    if (state) state.activity = activity
  }

  function finishActivity(
    sessionId: SessionId,
    timeline: SessionRuntimeTimeline,
    state: SessionRuntimeActivity,
    status: AgentActivity['status'] = 'completed',
    summary = state.closingSummary
  ): void {
    const activity = {
      ...state.activity,
      status,
      summary: summary ?? state.activity.summary,
      completedAt: now(),
      secondaryLine: undefined,
    }

    if (state.published) {
      replaceActivity(timeline, activity)
      persistActivityRecord(timeline, { version: 1, type: 'activity', activity })
      publishTimeline(sessionId, `${activity.title}: ${status}`)
    } else {
      state.activity = activity
    }
  }

  function requestActivityCompletion(
    sessionId: SessionId,
    timeline: SessionRuntimeTimeline,
    state: SessionRuntimeActivity,
    summary?: string
  ): void {
    state.closingSummary = summary
    state.closingRequested = true

    if (timeline.currentActivityId === state.activity.id) timeline.currentActivityId = undefined

    if (state.pendingOperationIds.size === 0) finishActivity(sessionId, timeline, state)
  }

  function beginActivity(
    sessionId: SessionId,
    timeline: SessionRuntimeTimeline,
    properties: Readonly<{ kind: AgentActivityKind; title: string; expectedOutcome?: string }>,
    options: Readonly<{ closePrevious: boolean; publish: boolean }> = { closePrevious: true, publish: true }
  ): SessionRuntimeActivity | undefined {
    const run = activeRun(timeline)

    if (!run) return undefined

    if (options.closePrevious && timeline.currentActivityId) {
      const previous = timeline.activities.get(timeline.currentActivityId)
      if (previous) requestActivityCompletion(sessionId, timeline, previous)
    }

    const activity: AgentActivity = {
      type: 'activity',
      id: createId(),
      runId: run.id,
      kind: properties.kind,
      title: properties.title,
      expectedOutcome: properties.expectedOutcome,
      status: 'running',
      operationCount: 0,
      fileCount: 0,
      secondaryLine: properties.expectedOutcome,
      artifacts: [],
      startedAt: now(),
    }

    const state: SessionRuntimeActivity = {
      activity,
      pendingOperationIds: new Set(),
      closingRequested: false,
      published: options.publish,
    }

    timeline.activities.set(activity.id, state)
    timeline.currentActivityId = activity.id

    if (options.publish) publishActivity(sessionId, timeline, state)

    return state
  }

  function publishActivity(
    sessionId: SessionId,
    timeline: SessionRuntimeTimeline,
    state: SessionRuntimeActivity,
    announcement = `${state.activity.title}: ${state.activity.status === 'running' ? 'started' : state.activity.status}`
  ): void {
    if (!timeline.entries.some((entry) => entry.type === 'activity' && entry.id === state.activity.id)) {
      const activityIds = [...timeline.activities.keys()]
      const activityIndex = activityIds.indexOf(state.activity.id)
      const nextPublishedId = activityIds
        .slice(activityIndex + 1)
        .find((id) => timeline.entries.some((entry) => entry.type === 'activity' && entry.id === id))
      const insertionIndex = nextPublishedId
        ? timeline.entries.findIndex((entry) => entry.type === 'activity' && entry.id === nextPublishedId)
        : timeline.entries.length

      timeline.entries.splice(insertionIndex, 0, state.activity)
    }

    state.published = true

    const run = activeRun(timeline)

    if (run && !run.activityIds.includes(state.activity.id)) {
      const updatedRun = { ...run, activityIds: [...run.activityIds, state.activity.id] }
      replaceRun(timeline, updatedRun)
      persistActivityRecord(timeline, { version: 1, type: 'run', run: updatedRun })
    }

    persistActivityRecord(timeline, { version: 1, type: 'activity', activity: state.activity })

    for (const operation of timeline.operations.values()) {
      if (operation.execution.activityId === state.activity.id) {
        persistActivityRecord(timeline, {
          version: 1,
          type: 'operation',
          execution: operationRecord(operation.execution),
        })
      }
    }

    publishTimeline(sessionId, announcement)
  }

  function fallbackActivity(
    sessionId: SessionId,
    timeline: SessionRuntimeTimeline
  ): SessionRuntimeActivity | undefined {
    const current = timeline.currentActivityId ? timeline.activities.get(timeline.currentActivityId) : undefined

    if (current?.activity.kind === 'other' && current.activity.status === 'running') return current

    return beginActivity(sessionId, timeline, { kind: 'other', title: 'Working on your request' })
  }

  function stringProperty(value: unknown, key: string): string | undefined {
    if (typeof value !== 'object' || value === null) return undefined

    const property = (value as Record<string, unknown>)[key]

    return typeof property === 'string' && property.trim().length > 0 ? property.trim() : undefined
  }

  function acceptActivityControl(sessionId: SessionId, timeline: SessionRuntimeTimeline, toolCallId: string): void {
    const transition = timeline.controlTransitions.get(toolCallId)

    if (!transition || transition.accepted) return

    timeline.controlTransitions.set(toolCallId, { ...transition, accepted: true })

    if (transition.type === 'start') {
      let previousCompletionAnnouncement: string | undefined
      if (transition.previousActivity) {
        const previous = timeline.activities.get(transition.previousActivity.id)

        if (previous) {
          const completesImmediately = previous.pendingOperationIds.size === 0

          requestActivityCompletion(sessionId, timeline, previous)

          if (completesImmediately) previousCompletionAnnouncement = `${previous.activity.title}: completed`
        }
      }

      const activity = transition.activityId ? timeline.activities.get(transition.activityId) : undefined

      if (activity) {
        const startedAnnouncement = `${activity.activity.title}: ${activity.activity.status === 'running' ? 'started' : activity.activity.status}`
        publishActivity(
          sessionId,
          timeline,
          activity,
          previousCompletionAnnouncement
            ? `${previousCompletionAnnouncement}. ${startedAnnouncement}`
            : startedAnnouncement
        )
      }

      return
    }

    const activity = transition.activityId ? timeline.activities.get(transition.activityId) : undefined

    if (activity) requestActivityCompletion(sessionId, timeline, activity, transition.summary)
  }

  function handleRuntimeEvent(sessionId: SessionId, event: PiSessionRuntimeEvent): void {
    const timeline = getTimeline(sessionId)

    if (event.type === 'context_usage') {
      timeline.contextUsage = event.usage
      publishTimeline(sessionId)

      return
    }

    if (event.type === 'compaction_completed') {
      timeline.entries.push({ type: 'context-compaction', id: createId(), summary: event.summary, timestamp: now() })
      publishTimeline(sessionId)

      return
    }

    if (event.type === 'tool_execution_start') {
      clearNoProgressTimeout(sessionId)

      if (timeline.operations.has(event.toolCallId)) return

      if (event.toolName === 'start_activity') {
        const title = stringProperty(event.input, 'title')
        const kind = stringProperty(event.input, 'kind') as AgentActivityKind | undefined

        if (title && kind && declaredActivityKinds.has(kind)) {
          const previousActivity = timeline.currentActivityId
            ? timeline.activities.get(timeline.currentActivityId)?.activity
            : undefined

          const activity = beginActivity(
            sessionId,
            timeline,
            {
              title,
              kind,
              expectedOutcome: stringProperty(event.input, 'expectedOutcome'),
            },
            { closePrevious: false, publish: false }
          )

          timeline.controlTransitions.set(event.toolCallId, {
            type: 'start',
            activityId: activity?.activity.id,
            previousActivity,
          })
        }

        return
      }

      if (event.toolName === 'complete_activity') {
        const current = timeline.currentActivityId ? timeline.activities.get(timeline.currentActivityId) : undefined
        const summary = stringProperty(event.input, 'summary')

        if (current && summary) {
          timeline.controlTransitions.set(event.toolCallId, {
            type: 'complete',
            activityId: current.activity.id,
            previousActivity: current.activity,
            summary,
          })

          timeline.currentActivityId = undefined
        }

        return
      }

      const owner =
        (timeline.currentActivityId ? timeline.activities.get(timeline.currentActivityId) : undefined) ??
        fallbackActivity(sessionId, timeline)

      if (!owner) return

      const execution: ToolExecution = {
        toolCallId: event.toolCallId,
        activityId: owner.activity.id,
        toolName: event.toolName,
        label: event.toolName.replaceAll('_', ' '),
        status: 'running',
        input: event.input,
        inputPreview: deriveOperationInputPreview(event.toolName, event.input, timeline.runtimeDirectory ?? ''),
      }

      timeline.operations.set(event.toolCallId, { execution })
      owner.pendingOperationIds.add(event.toolCallId)

      replaceActivity(timeline, {
        ...owner.activity,
        operationCount: owner.activity.operationCount + 1,
        secondaryLine: `Running ${execution.label}`,
      })

      if (owner.published) {
        persistActivityRecord(timeline, { version: 1, type: 'operation', execution: operationRecord(execution) })
        persistActivityRecord(timeline, { version: 1, type: 'activity', activity: owner.activity })
        publishTimeline(sessionId)
      }

      return
    }

    if (event.type === 'activity_control_accepted') {
      acceptActivityControl(sessionId, timeline, event.toolCallId)
      return
    }

    if (event.type === 'action_card_created') {
      const card = {
        id: createId(),
        sessionId,
        kind: event.input.kind,
        title: event.input.title,
        description: event.input.description,
        status: 'available' as const,
        createdAt: event.createdAt,
      }
      timeline.actionCards.push(card)
      persistActivityRecord(timeline, { version: 1, type: 'action-card', card })
      publishTimeline(sessionId, 'Action available.')
      return
    }

    if (event.type === 'tool_execution_end') {
      if (activityControlTools.has(event.toolName)) {
        const transition = timeline.controlTransitions.get(event.toolCallId)

        if (!transition) return

        if (!event.isError) {
          if (!transition.accepted) acceptActivityControl(sessionId, timeline, event.toolCallId)

          timeline.controlTransitions.delete(event.toolCallId)
          armNoProgressTimeout(sessionId, timeline)

          return
        }

        timeline.controlTransitions.delete(event.toolCallId)

        let fallbackActivityId: string | undefined

        if (transition.type === 'start' && transition.activityId) {
          const rejectedState = timeline.activities.get(transition.activityId)
          const rejectedOperations = [...timeline.operations.values()].filter(
            ({ execution }) => execution.activityId === transition.activityId
          )

          timeline.entries = timeline.entries.filter(
            (entry) => entry.type !== 'activity' || entry.id !== transition.activityId
          )
          timeline.activities.delete(transition.activityId)

          const run = activeRun(timeline)

          if (transition.accepted) {
            persistActivityRecord(timeline, { version: 1, type: 'activity-removed', activityId: transition.activityId })
          }

          if (run) {
            const restoredRun = {
              ...run,
              activityIds: run.activityIds.filter((id) => id !== transition.activityId),
            }

            replaceRun(timeline, restoredRun)

            if (transition.accepted) persistActivityRecord(timeline, { version: 1, type: 'run', run: restoredRun })
          }

          if (rejectedOperations.length > 0 && rejectedState) {
            timeline.currentActivityId = undefined

            const fallback =
              [...timeline.activities.values()].find(
                (state) => state.activity.kind === 'other' && state.activity.status === 'running'
              ) ??
              beginActivity(
                sessionId,
                timeline,
                { kind: 'other', title: 'Working on your request' },
                { closePrevious: false, publish: true }
              )

            if (fallback) {
              fallbackActivityId = fallback.activity.id

              for (const operation of rejectedOperations) {
                operation.execution = { ...operation.execution, activityId: fallback.activity.id }

                if (operation.execution.status === 'running') {
                  fallback.pendingOperationIds.add(operation.execution.toolCallId)
                }

                persistActivityRecord(timeline, {
                  version: 1,
                  type: 'operation',
                  execution: operationRecord(operation.execution),
                })
              }

              const artifacts = mergeActivityArtifacts(fallback.activity.artifacts, rejectedState.activity.artifacts)

              replaceActivity(timeline, {
                ...fallback.activity,
                operationCount: fallback.activity.operationCount + rejectedOperations.length,
                fileCount: countArtifactFiles(artifacts),
                artifacts,
                secondaryLine: rejectedState.activity.secondaryLine,
              })

              persistActivityRecord(timeline, { version: 1, type: 'activity', activity: fallback.activity })
              publishTimeline(sessionId)
            }
          }
        }

        if (transition.previousActivity) {
          replaceActivity(timeline, transition.previousActivity)

          const previousState = timeline.activities.get(transition.previousActivity.id)

          if (previousState) {
            previousState.closingRequested = false
            previousState.closingSummary = undefined
          }

          timeline.currentActivityId = transition.previousActivity.id

          if (transition.accepted) {
            persistActivityRecord(timeline, { version: 1, type: 'activity', activity: transition.previousActivity })
          }
        } else {
          timeline.currentActivityId = fallbackActivityId
        }

        publishTimeline(sessionId)

        return
      }

      const operation = timeline.operations.get(event.toolCallId)

      if (!operation || operation.execution.status !== 'running') return

      operation.execution = {
        ...operation.execution,
        status: event.isError ? 'failed' : 'completed',
        rawResultReference: event.rawResultReference ?? event.toolCallId,
      }
      operation.result = event.result

      const owner = timeline.activities.get(operation.execution.activityId)

      if (!owner) return

      owner.pendingOperationIds.delete(event.toolCallId)

      const artifacts = mergeActivityArtifacts(
        owner.activity.artifacts,
        deriveActivityArtifacts(
          operation.execution,
          event.result,
          timeline.runtimeDirectory ?? '',
          event.isError,
          timeline.getActivityRepositoryLocations?.()
        )
      )

      replaceActivity(timeline, {
        ...owner.activity,
        artifacts,
        fileCount: countArtifactFiles(artifacts),
        secondaryLine: event.isError
          ? `${operation.execution.label} failed`
          : owner.pendingOperationIds.size === 0
            ? 'Waiting for Pi…'
            : `${operation.execution.label} finished`,
      })

      if (owner.published) {
        persistActivityRecord(timeline, {
          version: 1,
          type: 'operation',
          execution: operationRecord(operation.execution),
        })
        persistActivityRecord(timeline, { version: 1, type: 'activity', activity: owner.activity })
      }

      if (owner.closingRequested && owner.pendingOperationIds.size === 0) {
        finishActivity(sessionId, timeline, owner)
      } else if (owner.published) {
        publishTimeline(sessionId)
      }

      if (owner.pendingOperationIds.size === 0) {
        armNoProgressTimeout(sessionId, timeline)
      }

      return
    }

    if (event.type === 'model_turn_started') {
      armNoProgressTimeout(sessionId, timeline, event.noProgressTimeoutMs)

      return
    }

    if (event.type === 'model_turn_progress') {
      const timeoutMs = noProgressTimeoutDurationsBySessionId.get(sessionId)

      if (timeoutMs !== undefined) armNoProgressTimeout(sessionId, timeline, timeoutMs)

      return
    }

    if (event.type === 'message_upsert') {
      const existing = timeline.messages.get(event.message.id)
      const message = { ...event.message, revision: timeline.revision + 1 }
      timeline.messages.set(message.id, message)

      if (!existing) {
        const run = activeRun(timeline)
        timeline.entries.push({
          type: 'conversation',
          id: message.id,
          runId: run?.id,
          role: message.role,
          text: message.text,
          timestamp: now(),
        })
      } else {
        const index = timeline.entries.findIndex((entry) => entry.type === 'conversation' && entry.id === message.id)
        const entry = index >= 0 ? timeline.entries[index] : undefined
        if (entry?.type === 'conversation') timeline.entries[index] = { ...entry, text: message.text }
      }

      publishTimeline(sessionId)
      return
    }

    if (event.type === 'agent_settled' || event.type === 'failed' || event.type === 'cancelled') {
      clearNoProgressTimeout(sessionId)
      activeAgentRunReservations.delete(sessionId)

      const activityStatus = event.type === 'failed' ? 'failed' : event.type === 'cancelled' ? 'blocked' : 'completed'
      const runStatus = event.type === 'failed' ? 'failed' : event.type === 'cancelled' ? 'cancelled' : 'completed'
      const explanation = event.type === 'failed' || event.type === 'cancelled' ? event.explanation : undefined
      const announcements: string[] = []

      for (const state of timeline.activities.values()) {
        if (state.activity.status === 'running' || state.activity.status === 'pending') {
          finishActivity(sessionId, timeline, state, activityStatus, explanation ?? state.closingSummary)
          announcements.push(`${state.activity.title}: ${activityStatus}`)
        }
      }

      timeline.currentActivityId = undefined

      const run = activeRun(timeline)

      if (run) {
        const completedRun = { ...run, status: runStatus, completedAt: now() } as AgentRun

        replaceRun(timeline, completedRun)
        persistActivityRecord(timeline, { version: 1, type: 'run', run: completedRun })

        if (event.type === 'failed' || event.type === 'cancelled') {
          persistActivityRecord(timeline, {
            version: 1,
            type: 'diagnostic',
            runId: run.id,
            kind: event.diagnosticKind ?? (event.type === 'cancelled' ? 'runtime-cancellation' : 'provider-failure'),
            explanation: event.explanation,
          })
        }

        publishTimeline(sessionId, announcements.join('. ') || undefined)
      }

      void dispatchNextQueuedFollowUp(sessionId)

      const reconcileAfterRun = sessionReconciliationBySessionId.get(sessionId)

      if (reconcileAfterRun) {
        const reconciliation = reconcileAfterRun()
          .then((sessionPersisted) => {
            if (sessionPersisted && sessionReconciliationBySessionId.get(sessionId) === reconcileAfterRun) {
              sessionReconciliationBySessionId.delete(sessionId)
            }
          })
          .catch((error: unknown) => {
            console.error(`Unable to reconcile Session ${sessionId} after its Agent Run.`, error)
          })
          .finally(() => {
            if (reconciliationPromisesBySessionId.get(sessionId) === reconciliation) {
              reconciliationPromisesBySessionId.delete(sessionId)
            }
          })

        reconciliationPromisesBySessionId.set(sessionId, reconciliation)
      }
    }
  }

  function attachRuntime(
    sessionId: SessionId,
    runtimeDirectory: string,
    runtime: PiSessionRuntime,
    runtimeKey?: string
  ): SessionRuntimeEntry {
    const timeline = getTimeline(sessionId)

    timeline.runtimeDirectory = runtimeDirectory
    timeline.persist = runtime.appendActivityRecord?.bind(runtime)
    timeline.loadRawOperation = runtime.loadRawOperation?.bind(runtime)
    timeline.getActivityRepositoryLocations = runtime.getActivityRepositoryLocations?.bind(runtime)
    // The attaching runtime is authoritative for the Model's context window;
    // context_usage events keep it current from here.
    timeline.contextUsage = runtime.getContextUsage?.()
    const history = runtime.loadHistory?.()
    hydrateTimeline(timeline, history)
    hydrateQueuedFollowUps(sessionId, history)

    const unsubscribes = [runtime.subscribe((event) => handleRuntimeEvent(sessionId, event))]
    return { runtime, runtimeKey, unsubscribes }
  }

  const lifecycle = createSessionRuntimeLifecycle({
    findSession,
    createSession,
    attach: attachRuntime,
  })
  const getRuntime = lifecycle.get

  const configuration = createSessionRuntimeConfiguration({
    getRuntime,
    withActivationGate: activationGate.run,
  })

  function acceptRun(
    sessionId: SessionId,
    messageId: string,
    text: string,
    skills?: readonly SessionSkillMention[],
    delivery?: 'steer'
  ): void {
    const timeline = getTimeline(sessionId)
    const message: SessionTranscriptMessage = {
      id: messageId,
      role: 'user',
      text,
      skills,
      delivery,
      state: 'complete',
      revision: timeline.revision + 1,
    }

    timeline.messages.set(message.id, message)
  }

  function queueFollowUp(
    submission: SessionMessageSubmission,
    runtime: PiSessionRuntime
  ): SessionMessageSubmissionResult {
    const projected = projectSessionSkillSelections(submission.text)
    const availableSkills = runtime.getSkills?.() ?? []
    const skillsAvailable = projected.selections.every((selection) =>
      availableSkills.some((skill) => skill.name === selection.name)
    )

    if (!skillsAvailable) return { status: 'rejected', reason: 'skill-unavailable' }

    try {
      if (replaceSessionSkillTokens(submission.text, (name) => runtime.getSkillPrompt?.(name)) === undefined) {
        return { status: 'rejected', reason: 'skill-unavailable' }
      }
    } catch {
      return { status: 'rejected', reason: 'unexpected' }
    }

    const queue = queuedFollowUpQueue.queuedFollowUps(submission.sessionId)

    if (queue.length >= maximumPendingSessionFollowUps) {
      return { status: 'rejected', reason: 'follow-up-capacity' }
    }

    const skills = projected.selections.flatMap((selection): SessionSkillMention[] => {
      const available = availableSkills.find((skill) => skill.name === selection.name)

      return available ? [{ offset: selection.offset, skill: { ...available, availability: 'available' } }] : []
    })
    const followUp = {
      id: createId(),
      text: submission.text,
      skills: skills.length > 0 ? skills : undefined,
      createdAt: now(),
    }
    const persisted = persistActivityRecord(getTimeline(submission.sessionId), {
      version: 1,
      type: 'queued-follow-up',
      followUp,
    })

    if (!persisted) return { status: 'rejected', reason: 'unexpected' }

    queuedFollowUpQueue.enqueue(submission.sessionId, followUp)
    publishTimeline(submission.sessionId)

    return { status: 'accepted', delivery: 'follow-up' }
  }

  async function deliverSubmission(
    submission: SessionMessageSubmission,
    runtime: PiSessionRuntime,
    authorize: () => boolean | Promise<boolean>
  ): Promise<SessionMessageSubmissionResult> {
    const projected = projectSessionSkillSelections(submission.text)
    const availableSkills = runtime.getSkills?.() ?? []
    const skills = projected.selections.flatMap((selection): SessionSkillMention[] => {
      const available = availableSkills.find((skill) => skill.name === selection.name)

      return available ? [{ offset: selection.offset, skill: { ...available, availability: 'available' } }] : []
    })
    if (skills.length !== projected.selections.length) {
      return { status: 'rejected', reason: 'skill-unavailable' }
    }
    const skillMentions = skills.length > 0 ? skills : undefined

    let promptText: string | undefined
    try {
      promptText = replaceSessionSkillTokens(submission.text, (name) => runtime.getSkillPrompt?.(name))
    } catch {
      return { status: 'rejected', reason: 'unexpected' }
    }
    if (promptText === undefined) return { status: 'rejected', reason: 'skill-unavailable' }
    const result = await activationGate.run<SessionMessageSubmissionResult>(submission.sessionId, async () => {
      try {
        if (!(await authorize())) return { status: 'rejected', reason: 'session-unavailable' }
      } catch {
        return { status: 'rejected', reason: 'unexpected' }
      }

      const wasWorking = runtime.isStreaming
      const acceptedDelivery: AcceptedSessionMessageDelivery =
        submission.delivery === 'action' ? 'action' : wasWorking ? submission.delivery : 'prompt'
      const streamingBehavior = wasWorking ? (submission.delivery === 'follow-up' ? 'followUp' : 'steer') : undefined

      return new Promise<SessionMessageSubmissionResult>((resolve) => {
        let preflightComplete = false
        let accepted = false

        const finishPreflight = (wasAccepted: boolean) => {
          if (preflightComplete) {
            return
          }

          preflightComplete = true
          accepted = wasAccepted

          if (wasAccepted) {
            const timeline = getTimeline(submission.sessionId)
            const activeRun = timeline.runs.find((run) => run.status === 'running')
            const messageId = `accepted-${nextAcceptedMessageId++}`
            const timestamp = now()
            const runId = activeRun?.id ?? createId()
            const message: ConversationEntry = {
              type: 'conversation',
              id: messageId,
              runId,
              role: 'user',
              text: projected.text,
              skills: skillMentions,
              delivery: acceptedDelivery === 'steer' ? 'steer' : undefined,
              timestamp,
            }

            if (acceptedDelivery !== 'action') timeline.entries.push(message)

            if (!activeRun) {
              const run: AgentRun = {
                id: runId,
                initiatingMessageId: messageId,
                status: 'running',
                activityIds: [],
                startedAt: timestamp,
              }

              timeline.runs.push(run)
              persistActivityRecord(timeline, { version: 1, type: 'run', run })
            }

            if (acceptedDelivery !== 'action') {
              acceptRun(
                submission.sessionId,
                messageId,
                projected.text,
                skillMentions,
                acceptedDelivery === 'steer' ? 'steer' : undefined
              )
            }

            if (acceptedDelivery === 'steer' || acceptedDelivery === 'action') {
              persistActivityRecord(timeline, {
                version: 1,
                type: acceptedDelivery === 'action' ? 'action-message' : 'steering-message',
                text: projected.text,
                acceptedAt: timestamp,
              })
            }

            publishTimeline(submission.sessionId)
          }

          resolve(
            wasAccepted
              ? { status: 'accepted', delivery: acceptedDelivery }
              : { status: 'rejected', reason: 'preflight-rejected' }
          )
        }

        try {
          void runtime
            .prompt(promptText, {
              streamingBehavior,
              preflightResult: finishPreflight,
            })
            .then(() => {
              if (!preflightComplete) {
                finishPreflight(false)
              }
            })
            .catch((error: unknown) => {
              if (!preflightComplete) {
                finishPreflight(false)
              } else if (accepted) {
                console.error('An accepted Session run failed.', error)
                handleRuntimeEvent(submission.sessionId, {
                  type: 'failed',
                  explanation: 'The provider request failed.',
                  diagnosticKind: 'provider-failure',
                })
              }
            })
        } catch {
          finishPreflight(false)
        }
      })
    })

    return result
  }

  async function compactImmediately(sessionId: SessionId): Promise<SessionContextCompactionResult> {
    const timeline = getTimeline(sessionId)
    if (timeline.runs.some((run) => run.status === 'running'))
      return { status: 'rejected', message: 'Wait for the Agent Run to finish before compacting.' }
    if (timeline.isCompacting) return { status: 'rejected', message: 'Session context is already compacting.' }

    let leaseAcquired: boolean
    try {
      leaseAcquired = await acquireCompactionLease(sessionId)
    } catch {
      return { status: 'rejected', message: 'Pi couldn’t reserve this Session for context compaction.' }
    }

    if (!leaseAcquired) {
      return { status: 'rejected', message: 'This Session is unavailable or already busy.' }
    }

    try {
      timeline.isCompacting = true
      publishTimeline(sessionId, 'Compacting Session context…')

      let runtime: SessionRuntimeEntry | undefined
      try {
        const entry = lifecycle.getEntry(sessionId)
        runtime = entry
          ? await entry
          : await getRuntime(sessionId).then((value) =>
              value ? ({ runtime: value } as SessionRuntimeEntry) : undefined
            )
      } catch {
        timeline.isCompacting = false
        publishTimeline(sessionId, 'Session context compaction failed.')
        return { status: 'rejected', message: 'Pi couldn’t open this Session.' }
      }

      if (!runtime?.runtime.compact || runtime.runtime.canCompact?.() === false) {
        timeline.isCompacting = false
        publishTimeline(sessionId)
        return {
          status: 'rejected',
          message: runtime?.runtime.compact
            ? 'More Session context is needed before it can be compacted.'
            : 'This Session does not support manual compaction.',
        }
      }

      try {
        await runtime.runtime.compact()
        timeline.isCompacting = false
        publishTimeline(sessionId, 'Session context compacted.')
        return { status: 'compacted' }
      } catch (error) {
        timeline.isCompacting = false
        publishTimeline(sessionId, 'Session context compaction failed.')
        return {
          status: 'rejected',
          message: error instanceof Error ? error.message : 'Context could not be compacted.',
        }
      }
    } finally {
      try {
        await releaseCompactionLease(sessionId)
      } catch (error) {
        console.error('Unable to release a Session context compaction lease.', error)
      }
    }
  }

  async function compact(sessionId: SessionId): Promise<SessionContextCompactionResult> {
    const previous = submissionQueuesBySessionId.get(sessionId) ?? Promise.resolve()
    let release!: () => void
    const current = new Promise<void>((resolve) => {
      release = resolve
    })
    const queued = previous.then(() => current)

    submissionQueuesBySessionId.set(sessionId, queued)

    try {
      await previous
      return await activationGate.run(sessionId, () => compactImmediately(sessionId))
    } finally {
      release()
      if (submissionQueuesBySessionId.get(sessionId) === queued) {
        submissionQueuesBySessionId.delete(sessionId)
      }
    }
  }

  async function stop(sessionId: SessionId): Promise<SessionRunStopResult> {
    const timeline = timelineBySessionId.get(sessionId)

    if (!timeline || !activeRun(timeline)) return { status: 'not-running' }

    const pendingEntry = lifecycle.getEntry(sessionId)
    const entry = pendingEntry ? await pendingEntry.catch(() => undefined) : undefined

    if (entry?.runtime.abort) {
      let stopTimeout: ReturnType<typeof setTimeout> | undefined
      const abortOutcome = await Promise.race([
        entry.runtime.abort().then(
          () => 'completed' as const,
          () => 'failed' as const
        ),
        new Promise<'timeout'>((resolve) => {
          stopTimeout = setTimeout(() => resolve('timeout'), stopTimeoutMs)
        }),
      ])

      if (stopTimeout) clearTimeout(stopTimeout)

      if (abortOutcome !== 'completed' && activeRun(timeline) && pendingEntry) {
        await lifecycle.retire(sessionId, pendingEntry)
      }
    }

    if (activeRun(timeline)) {
      handleRuntimeEvent(sessionId, {
        type: 'cancelled',
        explanation: 'Stopped by user.',
        diagnosticKind: 'runtime-cancellation',
      })
    }

    await reconciliationPromisesBySessionId.get(sessionId)

    return { status: 'stopped' }
  }

  async function submitImmediately(submission: SessionMessageSubmission): Promise<SessionMessageSubmissionResult> {
    let runtime: PiSessionRuntime | undefined
    let leaseAcquired = false
    let runCapacityReserved = false

    try {
      if (!(await canSubmit(submission.sessionId))) return { status: 'rejected', reason: 'session-unavailable' }

      const existingEntry = lifecycle.getEntry(submission.sessionId)
      const existing = existingEntry ? await existingEntry : undefined
      if (existing?.runtime.isStreaming && submission.delivery === 'follow-up') {
        return queueFollowUp(submission, existing.runtime)
      }

      if (existing?.runtime.isStreaming) {
        return deliverSubmission(submission, existing.runtime, async () => {
          if (!(await canSubmit(submission.sessionId))) return false
          if (existing.runtimeKey === undefined) return true

          const currentLocation = await findSession(submission.sessionId)

          return currentLocation?.runtimeKey === existing.runtimeKey
        })
      }

      if (
        !activeAgentRunReservations.has(submission.sessionId) &&
        activeAgentRunReservations.size >= maximumConcurrentAgentRuns
      ) {
        return { status: 'rejected', reason: 'agent-run-capacity' }
      }

      activeAgentRunReservations.add(submission.sessionId)
      runCapacityReserved = true

      if (!(await acquireRunLease(submission.sessionId))) {
        activeAgentRunReservations.delete(submission.sessionId)
        return { status: 'rejected', reason: 'run-in-progress' }
      }
      leaseAcquired = true

      runtime = await getRuntime(submission.sessionId)
      if (!runtime) {
        activeAgentRunReservations.delete(submission.sessionId)
        await releaseRunLease(submission.sessionId)

        return { status: 'rejected', reason: 'runtime-unavailable' }
      }
    } catch {
      if (runCapacityReserved) activeAgentRunReservations.delete(submission.sessionId)

      if (leaseAcquired) {
        try {
          await releaseRunLease(submission.sessionId)
        } catch {
          // The authority will reconcile a retained lease on restart.
        }
      }

      return { status: 'rejected', reason: leaseAcquired ? 'runtime-unavailable' : 'unexpected' }
    }

    if (runtime.isStreaming && submission.delivery === 'follow-up') {
      activeAgentRunReservations.delete(submission.sessionId)
      await releaseRunLease(submission.sessionId)
      return queueFollowUp(submission, runtime)
    }

    const runReconciliation = reconcileAfterRun ? () => reconcileAfterRun(submission.sessionId) : undefined

    if (runReconciliation) {
      sessionReconciliationBySessionId.set(submission.sessionId, runReconciliation)
    }

    const result = await deliverSubmission(submission, runtime, () => canSubmit(submission.sessionId))

    if (result.status === 'rejected') {
      activeAgentRunReservations.delete(submission.sessionId)
      await releaseRunLease(submission.sessionId)

      if (sessionReconciliationBySessionId.get(submission.sessionId) === runReconciliation) {
        sessionReconciliationBySessionId.delete(submission.sessionId)
      }
    }

    return result
  }

  async function submit(submission: SessionMessageSubmission): Promise<SessionMessageSubmissionResult> {
    const previous = submissionQueuesBySessionId.get(submission.sessionId) ?? Promise.resolve()
    let release!: () => void
    const current = new Promise<void>((resolve) => {
      release = resolve
    })
    const queued = previous.then(() => current)

    submissionQueuesBySessionId.set(submission.sessionId, queued)

    try {
      await previous
      return await submitImmediately(submission)
    } finally {
      release()
      if (submissionQueuesBySessionId.get(submission.sessionId) === queued) {
        submissionQueuesBySessionId.delete(submission.sessionId)
      }
    }
  }

  return {
    registerRuntime(sessionId, runtimeDirectory, runtime, reconcileAfterRun) {
      lifecycle.register(sessionId, runtimeDirectory, runtime)

      if (reconcileAfterRun) {
        sessionReconciliationBySessionId.set(sessionId, reconcileAfterRun)
      }
    },
    submit,
    stop,
    compact,
    async removeQueuedFollowUp(sessionId, followUpId) {
      await getRuntime(sessionId)
      return removeQueuedFollowUp(sessionId, followUpId)
    },
    async resumeQueuedFollowUps(sessionId) {
      await getRuntime(sessionId)

      if (activeRun(getTimeline(sessionId)) || !queuedFollowUpQueue.resume(sessionId)) return false

      await dispatchNextQueuedFollowUp(sessionId)
      return true
    },
    async acceptActionCard(sessionId, actionCardId) {
      await getRuntime(sessionId)
      return acceptActionCard(sessionId, actionCardId)
    },
    async renameSession(sessionId, title) {
      const runtime = await getRuntime(sessionId)

      if (!runtime?.rename) {
        throw new Error('The Session was not found.')
      }

      runtime.rename(title)
    },
    getWorkingStateSnapshots() {
      return [...timelineBySessionId.keys()].map((sessionId) => {
        const current = transcriptSnapshot(sessionId)

        return { sessionId: current.sessionId, revision: current.revision, isWorking: current.isWorking }
      })
    },
    async loadActivityDetails(sessionId, activityId) {
      await getRuntime(sessionId)

      const timeline = timelineBySessionId.get(sessionId)

      if (!timeline?.activities.has(activityId)) return undefined

      const operations = [...timeline.operations.values()].filter(
        ({ execution }) => execution.activityId === activityId
      )

      return {
        activityId,
        operations: operations.map(({ execution, result }) => {
          const raw = timeline.loadRawOperation?.(execution.toolCallId)
          const input = safeDetailText(raw?.input ?? execution.input)
          const rawResult = raw?.result ?? result
          const output = rawResult === undefined ? undefined : safeDetailText(rawResult)
          const preview = deriveMutationPreview(
            { ...execution, input: raw?.input ?? execution.input },
            rawResult,
            timeline.runtimeDirectory ?? '',
            timeline.getActivityRepositoryLocations?.()
          )

          return {
            toolCallId: execution.toolCallId,
            label: execution.label,
            status: execution.status,
            inputPreview: execution.inputPreview,
            input: input.text,
            output: output?.text,
            preview,
            truncated: input.truncated || (output?.truncated ?? false) || (preview?.truncated ?? false),
          }
        }),
      }
    },
    async getTranscript(sessionId) {
      await getRuntime(sessionId)

      return transcriptSnapshot(sessionId)
    },
    async getAvailableSkills(sessionId) {
      return (await getRuntime(sessionId))?.getSkills?.() ?? []
    },
    subscribeTranscript(listener) {
      transcriptListeners.add(listener)

      return () => transcriptListeners.delete(listener)
    },
    getConfigurationSnapshot: configuration.getSnapshot,
    setConfigurationModel: configuration.setModel,
    setConfigurationEffort: configuration.setEffort,
    dismissConfigurationWarning: configuration.dismissWarning,
    subscribeConfiguration: configuration.subscribe,
    dispose() {
      for (const sessionId of lifecycle.sessionIds()) {
        if (activeRun(getTimeline(sessionId))) {
          handleRuntimeEvent(sessionId, { type: 'cancelled', explanation: 'Railyard closed.' })
        }
      }

      lifecycle.dispose()
      timelineBySessionId.clear()
      transcriptListeners.clear()
      sessionReconciliationBySessionId.clear()
      noProgressTimeoutsBySessionId.forEach((timeout) => clearTimeout(timeout))
      noProgressTimeoutsBySessionId.clear()
      noProgressTimeoutDurationsBySessionId.clear()
      reconciliationPromisesBySessionId.clear()
      configuration.dispose()
      activationGate.dispose()
      activeAgentRunReservations.clear()
      submissionQueuesBySessionId.clear()
      queuedFollowUpQueue.clear()
    },
  }
}

function transcriptMessage(message: SessionTranscriptMessage): SessionTranscriptMessage {
  return message
}
