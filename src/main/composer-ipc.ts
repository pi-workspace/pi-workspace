import { app, shell } from 'electron'
import { readFileSync } from 'node:fs'
import type { SessionManager } from '@earendil-works/pi-coding-agent'
import { isSessionSkillName, type SessionMessageSubmissionResult, type SessionRunStopResult } from '@/src/composer'
import type { ManagedSessionRuntimePolicy } from '@/src/domain/managed-session'
import type {
  WorkstreamKnowledgeCommand,
  WorkstreamKnowledgeMutationResult,
} from '@/src/domain/workstream-knowledge-transitions'
import {
  composerIpcChannels,
  parseQueuedFollowUpRemovalRequest,
  parseSessionCompactRequest,
  parseSessionMessageSubmission,
  parseSessionRunStopRequest,
} from '@/src/composer-ipc'
import { sessionId } from '@/src/domain/session'
import { parseSessionActionCardToolInput } from '@/src/session-action-cards'
import { parseSessionSkillsRequest, sessionSkillsIpcChannels } from '@/src/session-skills-ipc'
import type {
  SessionConfigurationEffort,
  SessionConfigurationModelSelection,
  SessionConfigurationSnapshot,
} from '@/src/session-configuration'
import {
  parseEffortSelection,
  parseModelSelection,
  parseSessionConfigurationRequest,
  sessionConfigurationIpcChannels,
} from '@/src/session-configuration-ipc'
import {
  activityLayerCustomEntryType,
  isActivityLayerRecord,
  type ActivityLayerRecord,
} from '@/src/main/activity-records'
import { createPiSessionMessageStream, projectPiUserMessage } from '@/src/main/pi-session-message-mapping'
import type { ApplicationAuthority } from '@/src/main/application-state'
import {
  createPiSessionRuntimeRegistry,
  type PiSessionRuntime,
  type PiSessionRuntimeEvent,
  type PiSessionRuntimeRegistry,
} from '@/src/main/pi-session-runtimes'
import { canCompactSessionHistory } from '@/src/main/pi-session-compaction'
import { classifyPersistedAgentState } from '@/src/main/pi-session-history'
import { createManagedSessionServices } from '@/src/main/managed-session-resources'
import { createManagedSessionRuntimePolicyGuard } from '@/src/main/managed-session-runtime-policy'
import {
  managedSessionMethodology,
  parsePiWorkstreamKnowledgeMutation,
  projectWorkspaceOverview,
} from '@/src/main/managed-session-tools'
import { broadcastToTrustedRenderers, handleTrustedIpc } from '@/src/main/trusted-ipc'
import { isAllowedExternalUrl } from '@/src/session-transcript'
import {
  parseActionCardAcceptanceRequest,
  parseSessionTranscriptRequest,
  parseTranscriptActivityDetailsRequest,
  sessionTranscriptIpcChannels,
} from '@/src/session-transcript-ipc'
import { agentActivityKinds, type ConversationEntry } from '@/src/session-timeline'
import { workstreamsIpcChannels } from '@/src/workstreams-ipc'

let composerRegistry: PiSessionRuntimeRegistry | undefined

const minimumModelTurnNoProgressTimeoutMs = 30 * 60 * 1_000

type PiSessionRuntimeOptions =
  | Readonly<{
      kind: 'default'
      setSessionDescription: (description: string) => Promise<void>
    }>
  | Readonly<{
      kind: 'managed'
      setSessionDescription: (description: string) => Promise<void>
      policy: ManagedSessionRuntimePolicy
      resolvePolicy: () => Promise<ManagedSessionRuntimePolicy | undefined>
      getWorkstreamKnowledge: () => Promise<unknown>
      applyWorkstreamKnowledgeCommand: (
        command: WorkstreamKnowledgeCommand
      ) => Promise<WorkstreamKnowledgeMutationResult>
      prepareSessionRepository: (
        repositoryId: string
      ) => Promise<Readonly<{ repositoryId: string; workingPath: string; resourcePolicyRevision: number }>>
    }>

export async function createPiSessionRuntime(
  directoryPath: string,
  sessionManager: SessionManager,
  options: PiSessionRuntimeOptions
): Promise<PiSessionRuntime> {
  const [{ createAgentSession, defineTool, stripFrontmatter }, { Type }] = await Promise.all([
    import('@earendil-works/pi-coding-agent'),
    import('@earendil-works/pi-ai'),
  ])

  const runtimeListeners = new Set<(event: PiSessionRuntimeEvent) => void>()
  let managedPolicyFailure: string | undefined
  const managedRunControl: { abort?: () => void } = {}
  const managedPolicyGuard =
    options.kind === 'managed'
      ? createManagedSessionRuntimePolicyGuard(options, (error) => {
          if (managedPolicyFailure) return

          managedPolicyFailure = error instanceof Error ? error.message : 'The managed Session runtime policy failed.'
          managedRunControl.abort?.()
        })
      : undefined

  const validateManagedPolicy = (): Promise<ManagedSessionRuntimePolicy> => {
    if (!managedPolicyGuard) throw new Error('The managed Session runtime policy is unavailable.')

    return managedPolicyGuard.validate()
  }

  const prepareManagedRepository = (repositoryId: string) => {
    if (!managedPolicyGuard) throw new Error('The managed Session runtime policy is unavailable.')

    return managedPolicyGuard.prepareRepository(repositoryId)
  }

  const startActivity = defineTool({
    name: 'start_activity',
    label: 'Start activity',
    description: 'Begin one meaningful, user-understandable unit of work.',
    promptSnippet: 'Declare the meaningful outcome you are starting',
    promptGuidelines: [
      'Use start_activity before each distinct phase of work, grouping commands and reads by meaningful outcome rather than creating an activity per operation.',
      'Complete the current Agent Activity before using start_activity for a materially different goal.',
    ],
    parameters: Type.Object({
      title: Type.String({ minLength: 1, description: 'A concise, stable, outcome-oriented title' }),
      kind: Type.Union(agentActivityKinds.map((kind) => Type.Literal(kind))),
      expectedOutcome: Type.Optional(Type.String({ minLength: 1 })),
    }),
    async execute(toolCallId) {
      if (options.kind === 'managed') await validateManagedPolicy()

      runtimeListeners.forEach((listener) =>
        listener({ type: 'activity_control_accepted', toolCallId, toolName: 'start_activity' })
      )

      return { content: [{ type: 'text' as const, text: 'Activity started.' }], details: {} }
    },
  })

  const completeActivity = defineTool({
    name: 'complete_activity',
    label: 'Complete activity',
    description: 'Complete the current meaningful unit of work with a concise outcome summary.',
    promptSnippet: 'Record the outcome of the current activity',
    promptGuidelines: ['Use complete_activity after the current Agent Activity reaches an outcome.'],
    parameters: Type.Object({
      summary: Type.String({ minLength: 1, description: 'A concise summary of the achieved or observed outcome' }),
    }),
    async execute(toolCallId) {
      if (options.kind === 'managed') await validateManagedPolicy()

      runtimeListeners.forEach((listener) =>
        listener({ type: 'activity_control_accepted', toolCallId, toolName: 'complete_activity' })
      )

      return { content: [{ type: 'text' as const, text: 'Activity completed.' }], details: {} }
    },
  })

  const setSessionDescription = defineTool({
    name: 'set_session_description',
    label: 'Set Session description',
    description: 'Set the short description shown for this Session in Railyard navigation.',
    promptSnippet: 'Summarize the current Session focus for Railyard navigation',
    promptGuidelines: [
      'Use set_session_description near the start of a Session and again when its focus materially changes. Write one or two concise sentences about the current goal, not a generic status update.',
    ],
    parameters: Type.Object({
      description: Type.String({
        minLength: 1,
        description: 'One or two concise sentences describing the current Session focus',
      }),
    }),
    async execute(_toolCallId, input) {
      await options.setSessionDescription(input.description)

      return { content: [{ type: 'text' as const, text: 'Session description updated.' }], details: {} }
    },
  })

  const suggestAction = defineTool({
    name: 'suggest_action',
    label: 'Suggest action',
    description: 'Show the user an optional Railyard action card for an allowlisted next step.',
    promptGuidelines: [
      'Use only when the suggested action follows clearly from the completed work.',
      'Use start-implement-session only in a Brainstorm Session when planning is ready for implementation.',
      'When implementation is ready for user review and a pull request can be created, call suggest_action with prepare-pull-request before completing your response.',
    ],
    parameters: Type.Object({
      kind: Type.Union([Type.Literal('start-implement-session'), Type.Literal('prepare-pull-request')]),
      title: Type.String({ minLength: 1 }),
      description: Type.String({ minLength: 1 }),
    }),
    async execute(_toolCallId, input) {
      const action = parseSessionActionCardToolInput(input)
      if (!action) throw new TypeError('An allowlisted action card with a title and description is required.')
      if (
        action.kind === 'start-implement-session' &&
        (options.kind !== 'managed' || options.policy.mode !== 'brainstorm')
      ) {
        throw new TypeError('Only a Brainstorm Session can suggest starting an Implement Session.')
      }

      runtimeListeners.forEach((listener) =>
        listener({ type: 'action_card_created', input: action, createdAt: Date.now() })
      )
      return { content: [{ type: 'text' as const, text: 'Action card shown to the user.' }], details: {} }
    },
  })

  const managedTools =
    options.kind === 'managed'
      ? [
          defineTool({
            name: 'workspace_overview',
            label: 'Workspace overview',
            description: 'Read metadata about the current Workspace and its Repositories without Repository content.',
            parameters: Type.Object({}),
            async execute() {
              const policy = await validateManagedPolicy()
              const overview = projectWorkspaceOverview(policy)

              return { content: [{ type: 'text' as const, text: JSON.stringify(overview) }], details: {} }
            },
          }),
          ...(options.policy.mode === 'implement'
            ? [
                defineTool({
                  name: 'prepare_repository',
                  label: 'Prepare Repository',
                  description:
                    'Create or reuse this Implement Session’s isolated worktree for one Workspace Repository before modifying it.',
                  parameters: Type.Object({
                    repositoryId: Type.String({ minLength: 1, description: 'Repository id from workspace_overview' }),
                  }),
                  async execute(_toolCallId, input) {
                    const prepared = await prepareManagedRepository(input.repositoryId)

                    return {
                      content: [
                        {
                          type: 'text' as const,
                          text: JSON.stringify({
                            repositoryId: prepared.repositoryId,
                            workingPath: prepared.workingPath,
                          }),
                        },
                      ],
                      details: {},
                    }
                  },
                }),
              ]
            : []),
          defineTool({
            name: 'workstream_knowledge',
            label: 'Workstream knowledge',
            description: 'Read the current durable knowledge owned by this Workstream.',
            parameters: Type.Object({}),
            async execute() {
              await validateManagedPolicy()
              const state = await options.getWorkstreamKnowledge()

              return { content: [{ type: 'text' as const, text: JSON.stringify(state) }], details: {} }
            },
          }),
          defineTool({
            name: 'update_workstream_knowledge',
            label: 'Update Workstream knowledge',
            description:
              'Create, revise, or tombstone a draft Workstream record. Read workstream_knowledge first and supply its current optimistic revisions. User-only decision, assumption, and specification transitions are unavailable.',
            parameters: Type.Object({
              operation: Type.Union([Type.Literal('put-record'), Type.Literal('tombstone-record')]),
              expectedKnowledgeRevision: Type.Integer({ minimum: 0 }),
              expectedRecordRevision: Type.Integer({ minimum: 0 }),
              record: Type.Optional(Type.Unknown({ description: 'Complete structured record draft for put-record' })),
              recordId: Type.Optional(
                Type.String({ minLength: 1, description: 'Existing record ID for tombstone-record' })
              ),
            }),
            async execute(_toolCallId, input) {
              await validateManagedPolicy()
              const command = parsePiWorkstreamKnowledgeMutation(input)
              if (!command) throw new TypeError('A valid Pi-authorized Workstream knowledge mutation is required.')

              const result = await options.applyWorkstreamKnowledgeCommand(command)

              return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], details: {} }
            },
          }),
        ]
      : []
  const customTools = [startActivity, completeActivity, setSessionDescription, suggestAction, ...managedTools]
  const managedServices =
    options.kind === 'managed'
      ? await createManagedSessionServices(
          directoryPath,
          options.policy,
          managedSessionMethodology(options.policy.mode)
        )
      : undefined
  const { session } = await createAgentSession({
    cwd: directoryPath,
    sessionManager,
    customTools,
    resourceLoader: managedServices?.resourceLoader,
    settingsManager: managedServices?.settingsManager,
  })
  const getAvailableSkillResources = () =>
    session.settingsManager.getEnableSkillCommands()
      ? session.resourceLoader.getSkills().skills.filter(({ name }) => isSessionSkillName(name))
      : []
  const getAvailableSkills = () => getAvailableSkillResources().map(({ name, description }) => ({ name, description }))
  const getSkillPrompt = (name: string) => {
    const skill = getAvailableSkillResources().find((candidate) => candidate.name === name)
    if (!skill) return undefined

    const body = stripFrontmatter(readFileSync(skill.filePath, 'utf8')).trim()
    return `<skill name="${skill.name}" location="${skill.filePath}">\nReferences are relative to ${skill.baseDir}.\n\n${body}\n</skill>`
  }
  const configuredHttpIdleTimeoutMs = session.settingsManager.getHttpIdleTimeoutMs()
  const modelTurnNoProgressTimeoutMs =
    configuredHttpIdleTimeoutMs === 0
      ? minimumModelTurnNoProgressTimeoutMs
      : Math.max(minimumModelTurnNoProgressTimeoutMs, configuredHttpIdleTimeoutMs + 10_000)

  managedRunControl.abort = () => {
    if (!session.isStreaming) return

    void session.abort().catch((error: unknown) => {
      console.error('Unable to stop a managed Session after its runtime policy failed.', error)
    })
  }

  const getContextUsage = () => {
    const usage = session.getContextUsage()
    if (!usage) return undefined

    return {
      ...usage,
      canCompact: canCompactSessionHistory(
        session.sessionManager.getBranch(),
        session.settingsManager.getCompactionSettings()
      ),
    }
  }

  return {
    get isStreaming() {
      return session.isStreaming
    },
    prompt(text, options) {
      return session.prompt(text, options)
    },
    rename(title) {
      session.sessionManager.appendSessionInfo(title)
    },
    getContextUsage,
    compact() {
      return session.compact().then(() => undefined)
    },
    canCompact() {
      return getContextUsage()?.canCompact === true
    },
    subscribe(listener) {
      runtimeListeners.add(listener)

      const messageStream = createPiSessionMessageStream()
      const unsubscribe = session.subscribe((event) => {
        messageStream
          .handle(event)
          .forEach((messageEvent) => listener({ type: 'message_upsert', message: messageEvent.message }))

        if (event.type === 'agent_settled') {
          if (managedPolicyFailure) {
            const explanation = managedPolicyFailure
            managedPolicyFailure = undefined
            listener({ type: 'failed', explanation, diagnosticKind: 'stale-authority' })

            return
          }

          const lastAssistant = session.messages.filter((message) => message.role === 'assistant').at(-1)

          if (lastAssistant?.stopReason === 'error') {
            listener({
              type: 'failed',
              explanation: 'The provider request failed.',
              diagnosticKind: 'provider-failure',
            })

            return
          }

          if (lastAssistant?.stopReason === 'aborted') {
            listener({
              type: 'cancelled',
              explanation: 'The Agent Run was stopped.',
              diagnosticKind: 'runtime-cancellation',
            })

            return
          }
        }

        const normalized = normalizePiSessionEvent(event, modelTurnNoProgressTimeoutMs)

        if (normalized) listener(normalized)

        if (event.type === 'message_end' || event.type === 'compaction_end') {
          listener({ type: 'context_usage', usage: getContextUsage() })
        }
      })

      return () => {
        runtimeListeners.delete(listener)
        unsubscribe()
      }
    },
    abort() {
      return session.abort()
    },
    loadHistory() {
      const entries = session.sessionManager.getBranch()

      const conversations = entries.flatMap((entry): ConversationEntry[] => {
        if (entry.type !== 'message') return []

        const message = entry.message

        if (message.role !== 'user' && message.role !== 'assistant') return []

        const content = messageContent(message.content)
        const projected =
          message.role === 'user' ? projectPiUserMessage(content.text, getAvailableSkills()) : { text: content.text }

        if (message.role === 'assistant' && content.hasToolCalls) return []
        if (projected.text.length === 0 && !projected.skills?.length) return []

        return [
          {
            type: 'conversation',
            id: entry.id,
            role: message.role,
            ...projected,
            timestamp: message.timestamp,
          },
        ]
      })

      const compactions = entries.flatMap((entry) =>
        entry.type === 'compaction'
          ? [
              {
                type: 'context-compaction' as const,
                id: entry.id,
                summary: entry.summary,
                timestamp: Number.isFinite(Date.parse(entry.timestamp)) ? Date.parse(entry.timestamp) : Date.now(),
              },
            ]
          : []
      )

      const activityRecords = entries.flatMap((entry): ActivityLayerRecord[] => {
        return entry.type === 'custom' &&
          entry.customType === activityLayerCustomEntryType &&
          isActivityLayerRecord(entry.data)
          ? [entry.data]
          : []
      })

      const lastAssistant = entries
        .flatMap((entry) => (entry.type === 'message' && entry.message.role === 'assistant' ? [entry.message] : []))
        .at(-1)
      const finalState = classifyPersistedAgentState(lastAssistant)

      return { conversations, compactions, activityRecords, finalState }
    },
    appendActivityRecord(record) {
      session.sessionManager.appendCustomEntry(activityLayerCustomEntryType, record)
    },
    getSkills: getAvailableSkills,
    getSkillPrompt,
    loadRawOperation(toolCallId) {
      let input: unknown
      let result: unknown

      for (const entry of session.sessionManager.getBranch()) {
        if (entry.type !== 'message') continue

        const message = entry.message

        if (message.role === 'assistant') {
          const toolCall = message.content.find((part) => part.type === 'toolCall' && part.id === toolCallId)

          if (toolCall?.type === 'toolCall') input = toolCall.arguments
        }

        if (message.role === 'toolResult' && message.toolCallId === toolCallId) {
          result = { content: message.content, details: message.details, isError: message.isError }
        }
      }

      return input === undefined && result === undefined ? undefined : { input, result }
    },
    async getConfiguration() {
      await session.modelRuntime.refresh()
      const models = await session.modelRuntime.getAvailable()
      const supportsReasoning = session.supportsThinking()

      return {
        models: models.map((model) => ({
          provider: model.provider,
          providerName: session.modelRuntime.getProvider(model.provider)?.name ?? model.provider,
          id: model.id,
          name: model.name,
        })),
        model: session.model ? { provider: session.model.provider, id: session.model.id } : undefined,
        effort: supportsReasoning ? (session.thinkingLevel as SessionConfigurationEffort) : 'off',
        supportedEfforts: supportsReasoning
          ? (session.getAvailableThinkingLevels() as SessionConfigurationEffort[])
          : ['off'],
      } satisfies Omit<SessionConfigurationSnapshot, 'sessionId' | 'revision' | 'persistenceWarning'>
    },
    async setConfigurationModel(selection: SessionConfigurationModelSelection) {
      await session.modelRuntime.refresh()
      const model = (await session.modelRuntime.getAvailable()).find(
        (candidate) => candidate.provider === selection.provider && candidate.id === selection.id
      )

      if (!model) throw new Error('That Model is no longer available for this Session.')

      await session.setModel(model)
      session.settingsManager.setDefaultModelAndProvider(model.provider, model.id)
      runtimeListeners.forEach((listener) => listener({ type: 'context_usage', usage: getContextUsage() }))
    },
    async setConfigurationEffort(effort: SessionConfigurationEffort) {
      if (!session.supportsThinking() && effort === 'off') return
      if (effort === 'off' || !session.getAvailableThinkingLevels().includes(effort)) {
        throw new Error('That Effort is not supported by the selected Model.')
      }

      session.setThinkingLevel(effort)
      session.settingsManager.setDefaultThinkingLevel(effort)
    },
    async flushConfiguration() {
      await session.settingsManager.flush()

      return session.settingsManager.drainErrors().map(({ error }) => error.message)
    },
    dispose() {
      session.dispose()
    },
  }
}

function messageContent(content: unknown): { text: string; hasToolCalls: boolean } {
  if (typeof content === 'string') return { text: content, hasToolCalls: false }
  if (!Array.isArray(content)) return { text: '', hasToolCalls: false }

  return {
    text: content
      .flatMap((part) =>
        typeof part === 'object' && part !== null && (part as { type?: unknown }).type === 'text'
          ? [String((part as { text?: unknown }).text ?? '')]
          : []
      )
      .join(''),
    hasToolCalls: content.some(
      (part) => typeof part === 'object' && part !== null && (part as { type?: unknown }).type === 'toolCall'
    ),
  }
}

function normalizePiSessionEvent(
  event: { type: string; [key: string]: unknown },
  modelTurnNoProgressTimeoutMs: number
): PiSessionRuntimeEvent | undefined {
  if (event.type === 'tool_execution_start') {
    return {
      type: event.type,
      toolCallId: String(event.toolCallId),
      toolName: String(event.toolName),
      input: event.args,
    }
  }
  if (event.type === 'tool_execution_end') {
    return {
      type: event.type,
      toolCallId: String(event.toolCallId),
      toolName: String(event.toolName),
      result: event.result,
      isError: event.isError === true,
      rawResultReference: String(event.toolCallId),
    }
  }
  if (event.type === 'turn_start') {
    return { type: 'model_turn_started', noProgressTimeoutMs: modelTurnNoProgressTimeoutMs }
  }
  if (
    event.type === 'compaction_end' &&
    typeof event.result === 'object' &&
    event.result !== null &&
    typeof (event.result as { summary?: unknown }).summary === 'string'
  ) {
    return { type: 'compaction_completed', summary: (event.result as { summary: string }).summary }
  }
  if (
    event.type === 'message_start' ||
    event.type === 'message_update' ||
    event.type === 'auto_retry_start' ||
    event.type === 'auto_retry_end' ||
    event.type === 'compaction_start' ||
    event.type === 'compaction_end'
  ) {
    return { type: 'model_turn_progress' }
  }
  if (event.type === 'agent_end' || event.type === 'agent_settled') return { type: event.type }
  return undefined
}

export function initializeComposer(authority: ApplicationAuthority): void {
  if (composerRegistry) {
    return
  }

  const registry = createPiSessionRuntimeRegistry({
    findSession: (id) => authority.resolveOwnedSession(id),
    canSubmit: async (id) => {
      const resolution = await authority.resolveOwnedSession(id)

      return resolution?.canSubmit ?? false
    },
    acquireRunLease: (id) => authority.acquireSessionRunLease(id),
    releaseRunLease: async (id) => {
      await authority.settleSessionRunLease(id)
    },
    acquireCompactionLease: (id) => authority.acquireSessionCompactionLease(id),
    releaseCompactionLease: async (id) => {
      await authority.settleSessionCompactionLease(id)
    },
    reconcileAfterRun: (id) => authority.settleSessionRunLease(id),
    createSession: async ({ directoryPath, sessionPath, managedPolicy }, ownedSessionId) => {
      const { SessionManager } = await import('@earendil-works/pi-coding-agent')
      const sessionManager = SessionManager.open(sessionPath, undefined, directoryPath)
      const setSessionDescription = async (description: string) => {
        const snapshot = await authority.setSessionDescription(ownedSessionId, description)
        broadcastToTrustedRenderers(workstreamsIpcChannels.changed, snapshot)
      }

      if (!managedPolicy) {
        return createPiSessionRuntime(directoryPath, sessionManager, { kind: 'default', setSessionDescription })
      }

      return createPiSessionRuntime(directoryPath, sessionManager, {
        kind: 'managed',
        setSessionDescription,
        policy: managedPolicy,
        resolvePolicy: async () => (await authority.resolveOwnedSession(managedPolicy.sessionId))?.managedPolicy,
        getWorkstreamKnowledge: () => authority.getWorkstreamKnowledge(managedPolicy.workstreamId),
        applyWorkstreamKnowledgeCommand: (command) =>
          authority.applyPiWorkstreamKnowledgeCommand(managedPolicy.workstreamId, command, managedPolicy.sessionId),
        prepareSessionRepository: (repositoryId) =>
          authority.prepareSessionRepository(managedPolicy.sessionId, repositoryId),
      })
    },
  })
  composerRegistry = registry

  handleTrustedIpc(composerIpcChannels.compact, (_event, value: unknown) => {
    const request = parseSessionCompactRequest(value)
    return request
      ? registry.compact(request.sessionId)
      : Promise.resolve({ status: 'rejected' as const, message: 'Invalid Session.' })
  })

  handleTrustedIpc(composerIpcChannels.submit, (_event, value: unknown): Promise<SessionMessageSubmissionResult> => {
    const submission = parseSessionMessageSubmission(value)

    return submission
      ? registry.submit(submission)
      : Promise.resolve({ status: 'rejected', reason: 'invalid-submission' })
  })

  handleTrustedIpc(composerIpcChannels.stop, (_event, value: unknown): Promise<SessionRunStopResult> => {
    const request = parseSessionRunStopRequest(value)

    return request ? registry.stop(request.sessionId) : Promise.resolve({ status: 'not-running' })
  })

  handleTrustedIpc(composerIpcChannels.removeQueuedFollowUp, (_event, value: unknown): Promise<boolean> => {
    const request = parseQueuedFollowUpRemovalRequest(value)

    return request ? registry.removeQueuedFollowUp(request.sessionId, request.followUpId) : Promise.resolve(false)
  })

  handleTrustedIpc(composerIpcChannels.resumeQueuedFollowUps, (_event, value: unknown): Promise<boolean> => {
    const request = parseSessionRunStopRequest(value)

    return request ? registry.resumeQueuedFollowUps(request.sessionId) : Promise.resolve(false)
  })

  handleTrustedIpc(sessionSkillsIpcChannels.getAvailable, (_event, value: unknown) => {
    const request = parseSessionSkillsRequest(value)

    return request ? registry.getAvailableSkills(request.sessionId) : Promise.reject(new Error('Invalid Session.'))
  })

  handleTrustedIpc(sessionTranscriptIpcChannels.getSnapshot, (_event, value: unknown) => {
    const request = parseSessionTranscriptRequest(value)

    return request
      ? registry.getTranscript(sessionId(request.sessionId))
      : Promise.reject(new Error('Invalid Session.'))
  })

  handleTrustedIpc(sessionTranscriptIpcChannels.getWorkingStateSnapshots, () => registry.getWorkingStateSnapshots())

  handleTrustedIpc(sessionTranscriptIpcChannels.openExternalLink, async (_event, value: unknown) => {
    if (isAllowedExternalUrl(value)) await shell.openExternal(value)
  })

  handleTrustedIpc(sessionTranscriptIpcChannels.acceptActionCard, (_event, value: unknown) => {
    const request = parseActionCardAcceptanceRequest(value)

    return request
      ? registry.acceptActionCard(sessionId(request.sessionId), request.actionCardId)
      : Promise.resolve(false)
  })

  handleTrustedIpc(sessionTranscriptIpcChannels.loadActivityDetails, (_event, value: unknown) => {
    const request = parseTranscriptActivityDetailsRequest(value)

    return request
      ? registry.loadActivityDetails(sessionId(request.sessionId), request.activityId)
      : Promise.reject(new Error('Invalid Agent Activity.'))
  })

  registry.subscribeTranscript((mutation) => {
    broadcastToTrustedRenderers(sessionTranscriptIpcChannels.changed, mutation)
  })

  handleTrustedIpc(sessionConfigurationIpcChannels.getSnapshot, (_event, value: unknown) => {
    const request = parseSessionConfigurationRequest(value)

    return request
      ? registry.getConfigurationSnapshot(sessionId(request.sessionId))
      : Promise.reject(new Error('Invalid Session.'))
  })

  handleTrustedIpc(sessionConfigurationIpcChannels.setModel, (_event, value: unknown) => {
    const request = parseModelSelection(value)

    return request
      ? registry.setConfigurationModel(sessionId(request.sessionId), request.model)
      : Promise.reject(new Error('Invalid Model selection.'))
  })

  handleTrustedIpc(sessionConfigurationIpcChannels.setEffort, (_event, value: unknown) => {
    const request = parseEffortSelection(value)

    return request
      ? registry.setConfigurationEffort(sessionId(request.sessionId), request.effort)
      : Promise.reject(new Error('Invalid Effort selection.'))
  })

  handleTrustedIpc(sessionConfigurationIpcChannels.dismissWarning, (_event, value: unknown) => {
    const request = parseSessionConfigurationRequest(value)

    return request
      ? registry.dismissConfigurationWarning(sessionId(request.sessionId))
      : Promise.reject(new Error('Invalid Session.'))
  })

  registry.subscribeConfiguration((mutation) => {
    broadcastToTrustedRenderers(sessionConfigurationIpcChannels.changed(mutation.sessionId), mutation)
  })

  app.once('before-quit', () => {
    registry.dispose()
  })
}

export function getPiSessionRuntimeRegistry(): PiSessionRuntimeRegistry {
  if (!composerRegistry) {
    throw new Error('The Pi Session runtime registry has not been initialized.')
  }

  return composerRegistry
}
