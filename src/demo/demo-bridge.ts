import type { WorkspaceRepositorySnapshot } from '@/src/application-state'
import type { PiWorkspaceBridge } from '@/src/pi-workspace'
import { createSettingsSnapshot, defaultSettings, type SettingsSnapshot } from '@/src/settings'
import { getDemoScenario } from '@/src/demo/demo-scenarios'
import { sessionId } from '@/src/domain/session'
import type { WorkstreamsSnapshot } from '@/src/domain/workstream'
import type { SessionTranscriptSnapshot } from '@/src/session-transcript'
import {
  formatSessionCodeReviewText,
  type SessionCodeReview,
  type SessionCodeReviewDraft,
} from '@/src/session-code-review'
import {
  createEmptyWorkstreamKnowledge,
  deriveWorkstreamKnowledgeReadiness,
} from '@/src/domain/workstream-knowledge-transitions'

const demoModels = [{ provider: 'openai', providerName: 'OpenAI', id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol' }] as const
const demoModel = { provider: 'openai', id: 'gpt-5.6-sol' } as const

const demoRepositories: readonly WorkspaceRepositorySnapshot[] = [
  {
    availability: 'available',
    directoryPath: '/Users/maya/Projects/atlas-notes',
    id: 'Atlas Notes',
    membershipId: 'atlas-notes-app',
    name: 'Atlas Notes',
    relationships: ['northstar-web'],
    role: 'Desktop application',
    validationCommands: ['bun test'],
  },
  {
    availability: 'available',
    directoryPath: '/Users/maya/Projects/northstar-web',
    id: 'Northstar Web',
    membershipId: 'northstar-web',
    name: 'Northstar Web',
    relationships: ['atlas-notes-app'],
    role: 'Marketing site',
    validationCommands: ['bun test'],
  },
  {
    availability: 'available',
    directoryPath: '/Users/maya/Projects/atlas-web',
    id: 'Atlas Web',
    membershipId: 'atlas-web',
    name: 'Atlas Web',
    relationships: ['atlas-api'],
    role: 'Next.js customer application',
    validationCommands: ['bun test', 'bun run typecheck'],
  },
  {
    availability: 'available',
    directoryPath: '/Users/maya/Projects/atlas-api',
    id: 'Atlas API',
    membershipId: 'atlas-api',
    name: 'Atlas API',
    relationships: ['atlas-web'],
    role: 'Fastify API service',
    validationCommands: ['bun test', 'bun run typecheck'],
  },
]

export function createDemoBridge(scenarioName?: string): PiWorkspaceBridge {
  const scenario = structuredClone(getDemoScenario(scenarioName))
  const colorSchemeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
  let settingsSnapshot: SettingsSnapshot = createSettingsSnapshot(defaultSettings, colorSchemeMediaQuery.matches)
  let createdSessionNumber = 0
  let workstreamsSnapshot: WorkstreamsSnapshot = scenario.workstreams
  const transcriptsBySessionId: Record<string, SessionTranscriptSnapshot> = { ...scenario.transcriptsBySessionId }
  const transcriptListeners = new Set<Parameters<PiWorkspaceBridge['transcript']['subscribe']>[0]>()
  const settingsListeners = new Set<Parameters<PiWorkspaceBridge['settings']['subscribe']>[0]>()
  const codeReviewDrafts = new Map<string, SessionCodeReviewDraft>()
  const demoFileStaging = new Map<string, 'staged' | 'unstaged' | 'partial'>([
    ['src/notes/note-store.ts', 'partial'],
    ['src/notes/sync-queue.ts', 'unstaged'],
  ])

  colorSchemeMediaQuery.addEventListener('change', (event) => {
    if (settingsSnapshot.appearance !== 'system') {
      return
    }

    settingsSnapshot = createSettingsSnapshot({ ...settingsSnapshot, appearance: 'system' }, event.matches)

    for (const listener of settingsListeners) {
      listener(settingsSnapshot)
    }
  })

  const stagingState = (path: string) => {
    const state = demoFileStaging.get(path) ?? 'unstaged'
    return { staged: state !== 'unstaged', unstaged: state !== 'staged' }
  }

  const transcriptSnapshot = (requestedSessionId: string): SessionTranscriptSnapshot =>
    transcriptsBySessionId[requestedSessionId] ?? {
      sessionId: sessionId(requestedSessionId),
      revision: 0,
      isWorking: false,
      runs: [],
      entries: [],
    }
  const publishCodeReview = (requestedSessionId: string, codeReview: SessionCodeReview) => {
    const transcript = transcriptSnapshot(requestedSessionId)
    const revision = transcript.revision + 1
    const snapshot = {
      ...transcript,
      revision,
      entries: [
        ...transcript.entries,
        {
          type: 'message' as const,
          message: {
            id: `demo-review-${revision}`,
            role: 'user' as const,
            text: formatSessionCodeReviewText(codeReview),
            codeReview,
            state: 'complete' as const,
            revision,
          },
        },
      ],
    }
    transcriptsBySessionId[requestedSessionId] = snapshot
    transcriptListeners.forEach((listener) =>
      listener({ sessionId: sessionId(requestedSessionId), revision, snapshot })
    )
  }

  return {
    applicationState: {
      async getStartup() {
        return { status: 'ready' }
      },
      async createBackup() {
        return 'atlas-product-backup.sqlite'
      },
      async reset() {
        return { status: 'first-launch' }
      },
      async getWorkspaces() {
        return {
          revision: 0,
          workspaces: [
            {
              id: 'Atlas Product',
              name: 'Atlas Product',
              repositories: demoRepositories,
            },
          ],
        }
      },
      async createWorkspace() {
        return { status: 'cancelled' }
      },
      async renameWorkspace() {
        return this.getWorkspaces()
      },
      async addWorkspaceRepositories() {
        return { status: 'cancelled' }
      },
      async removeWorkspaceRepository() {
        return this.getWorkspaces()
      },
      async updateWorkspaceMembership() {
        return this.getWorkspaces()
      },
    },
    composer: {
      async compact() {
        return { status: 'compacted' as const }
      },
      async submit(submission) {
        if (!submission.codeReview) return { status: 'rejected' as const, reason: 'unexpected' as const }

        publishCodeReview(submission.sessionId, submission.codeReview)
        return { status: 'accepted' as const, delivery: submission.delivery }
      },
      async getCodeReviewDraft(sessionId) {
        return codeReviewDrafts.get(sessionId) ?? { comments: [] }
      },
      async saveCodeReviewComment(command) {
        const current = codeReviewDrafts.get(command.sessionId) ?? { comments: [] }
        const existing = command.commentId
          ? current.comments.find((comment) => comment.id === command.commentId)
          : undefined
        const comment = {
          id: existing?.id ?? `demo-review-${current.comments.length + 1}`,
          text: command.text,
          reference: command.reference,
          createdAt: existing?.createdAt ?? Date.now(),
        }
        const next = {
          comments: existing
            ? current.comments.map((candidate) => (candidate.id === existing.id ? comment : candidate))
            : [...current.comments, comment],
        }
        codeReviewDrafts.set(command.sessionId, next)
        return next
      },
      async removeCodeReviewComment(sessionId, commentId) {
        const next = {
          comments: (codeReviewDrafts.get(sessionId)?.comments ?? []).filter((comment) => comment.id !== commentId),
        }
        codeReviewDrafts.set(sessionId, next)
        return next
      },
      async finishCodeReview(sessionId) {
        const draft = codeReviewDrafts.get(sessionId) ?? { comments: [] }
        if (draft.comments.length === 0) return { status: 'rejected' as const, reason: 'invalid-submission' as const }

        codeReviewDrafts.set(sessionId, { comments: [] })
        publishCodeReview(sessionId, { kind: 'review', comments: draft.comments })
        return { status: 'accepted' as const, delivery: 'prompt' as const }
      },
      async stop() {
        return { status: 'not-running' }
      },
      async removeQueuedFollowUp(sessionId, followUpId) {
        const transcript = transcriptSnapshot(sessionId)
        const queuedFollowUps = transcript.queuedFollowUps ?? []

        if (!queuedFollowUps.some((followUp) => followUp.id === followUpId)) return false

        const snapshot = {
          ...transcript,
          revision: transcript.revision + 1,
          queuedFollowUps: queuedFollowUps.filter((followUp) => followUp.id !== followUpId),
        }
        transcriptsBySessionId[sessionId] = snapshot

        for (const listener of transcriptListeners) {
          listener({ sessionId, revision: snapshot.revision, snapshot })
        }

        return true
      },
      async resumeQueuedFollowUps() {
        return false
      },
    },
    sessionSkills: {
      async getAvailable() {
        return [
          { name: 'code-review', description: 'Review code changes for correctness and maintainability.' },
          { name: 'frontend-design', description: 'Create intentional, distinctive interfaces and interactions.' },
          { name: 'planning', description: 'Turn a goal into a focused implementation plan.' },
        ]
      },
    },
    sessionFiles: {
      async getAvailable() {
        return [
          { path: 'src/main/composer-ipc.ts', name: 'composer-ipc.ts', kind: 'file' as const },
          { path: 'src/renderer/components', name: 'components', kind: 'folder' as const },
        ]
      },
    },
    sessionChanges: {
      async getSnapshot(sessionId) {
        const session = workstreamsSnapshot.workstreams
          .flatMap((workstream) => workstream.sessions)
          .find((candidate) => candidate.id === sessionId)

        return {
          sessionId,
          repositories:
            session?.mode === 'implement'
              ? [
                  {
                    repositoryId: 'Atlas Notes',
                    repositoryName: 'Atlas Notes',
                    branch: {
                      head: 'railyard/offline-editing',
                      upstream: 'origin/main',
                      ahead: 2,
                      behind: 0,
                      detached: false,
                      unborn: false,
                    },
                    files: [
                      {
                        path: 'src/notes/note-store.ts',
                        status: 'modified' as const,
                        ...stagingState('src/notes/note-store.ts'),
                        additions: 8,
                        deletions: 2,
                      },
                      {
                        path: 'src/notes/sync-queue.ts',
                        status: 'added' as const,
                        ...stagingState('src/notes/sync-queue.ts'),
                        additions: 42,
                        deletions: 0,
                      },
                    ],
                  },
                ]
              : [],
        }
      },
      async loadFileDiff(_sessionId, _repositoryId, path, view) {
        if (path !== 'src/notes/note-store.ts' && path !== 'src/notes/sync-queue.ts') {
          return { status: 'unavailable', message: 'The changed file is no longer available.' }
        }

        return {
          status: 'available',
          content: `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1,2 +1,3 @@\n-export const sync = saveRemote\n+export const sync = queueLocalSave\n+export const state = '${view}'`,
          truncated: false,
        }
      },
      async setFileStaged(sessionId, _repositoryId, path, staged) {
        if (!demoFileStaging.has(path)) throw new Error('The changed file is no longer available.')

        demoFileStaging.set(path, staged ? 'staged' : 'unstaged')
        return this.getSnapshot(sessionId)
      },
    },
    sessionConfiguration: {
      async getSnapshot(sessionId) {
        return {
          sessionId,
          revision: 0,
          models: demoModels,
          model: demoModel,
          effort: 'medium',
          supportedEfforts: ['low', 'medium', 'high'],
        }
      },
      async setModel(sessionId) {
        return { status: 'rejected', snapshot: await this.getSnapshot(sessionId), message: 'Unavailable in the demo.' }
      },
      async setEffort(sessionId) {
        return { status: 'rejected', snapshot: await this.getSnapshot(sessionId), message: 'Unavailable in the demo.' }
      },
      async dismissWarning(sessionId) {
        return this.getSnapshot(sessionId)
      },
      subscribe() {
        return () => {}
      },
    },
    transcript: {
      async getSnapshot(sessionId) {
        return transcriptSnapshot(sessionId)
      },
      async getWorkingStateSnapshots() {
        return Object.values(transcriptsBySessionId).map(({ sessionId, revision, isWorking }) => ({
          sessionId,
          revision,
          isWorking,
        }))
      },
      async loadActivityDetails(sessionId, activityId) {
        return scenario.activityDetailsBySessionId[sessionId]?.[activityId]
      },
      async acceptActionCard() {
        return false
      },
      async openExternalLink() {},
      subscribe(listener) {
        transcriptListeners.add(listener)
        return () => transcriptListeners.delete(listener)
      },
    },
    workstreams: {
      async getSnapshot() {
        return workstreamsSnapshot
      },
      async previewWorktreeLocations(_workspaceId, repositoryId) {
        const workstreamId = '00000000-0000-4000-8000-000000000052'
        const repositories = demoRepositories.filter((repository) => repository.id === repositoryId)

        return {
          workstreamId,
          repositories: repositories.map((repository, index) => ({
            repositoryId: repository.id,
            repositoryName: repository.name,
            workingPath: `/Users/maya/Projects/.worktrees/${workstreamId}/${repository.id}`,
            branch: `railyard/${workstreamId}/${repository.id}`,
            baseCommit: index === 0 ? '8f31c2a' : 'c941a0e',
          })),
        }
      },
      async createWorkstream(workspaceId, options) {
        createdSessionNumber += 1
        const createdSessionId = sessionId(`workstream-session-${createdSessionNumber}`)
        const workstreamId = `workstream-${createdSessionNumber}`
        workstreamsSnapshot = {
          revision: workstreamsSnapshot.revision + 1,
          workstreams: [
            ...workstreamsSnapshot.workstreams,
            {
              id: workstreamId,
              workspaceId,
              goal: options.goal.trim(),
              lifecycle: 'active' as const,
              workingLocation: 'current-checkouts' as const,
              repositoryWorkingLocations: demoRepositories.map((repository) => ({
                repositoryId: repository.id,
                repositoryName: repository.name,
                kind: 'current-checkout' as const,
                availability: 'available' as const,
                workingPath: repository.directoryPath,
              })),
              sessions: [
                {
                  id: createdSessionId,
                  workstreamId,
                  title: 'New Session',
                  mode: options.mode ?? ('implement' as const),
                  availability: 'available' as const,
                  repositoryAccess: { kind: 'managed' as const },
                },
              ],
            },
          ],
        }

        return { status: 'available', sessionId: createdSessionId, snapshot: workstreamsSnapshot }
      },
      async createQuickSession(workspaceId, options) {
        createdSessionNumber += 1
        const createdSessionId = sessionId(`quick-session-${createdSessionNumber}`)
        const workstreamId = options.workstreamId ?? `quick-workstream-${createdSessionNumber}`
        const repository = demoRepositories.find((candidate) => candidate.id === options.repositoryId)
        const workingLocation = options.workingLocation ?? ('current-checkouts' as const)

        if (!repository) throw new TypeError('Select a Repository from the current Workspace.')

        workstreamsSnapshot = {
          revision: workstreamsSnapshot.revision + 1,
          workstreams: [
            ...workstreamsSnapshot.workstreams,
            {
              id: workstreamId,
              workspaceId,
              lifecycle: 'active' as const,
              workingLocation,
              repositoryWorkingLocations: [
                {
                  repositoryId: repository.id,
                  repositoryName: repository.name,
                  kind: workingLocation === 'worktrees' ? ('worktree' as const) : ('current-checkout' as const),
                  availability: 'available' as const,
                  workingPath:
                    workingLocation === 'worktrees'
                      ? `/Users/maya/Projects/.worktrees/${workstreamId}/${repository.id}`
                      : repository.directoryPath,
                },
              ],
              sessions: [
                {
                  id: createdSessionId,
                  workstreamId,
                  title: 'Quick Session',
                  mode: 'default' as const,
                  availability: 'available' as const,
                  repositoryAccess: {
                    kind: 'direct' as const,
                    repositoryId: repository.id,
                    repositoryName: repository.name,
                    availability: 'available',
                  },
                },
              ],
            },
          ],
        }

        return { status: 'available', sessionId: createdSessionId, snapshot: workstreamsSnapshot }
      },
      async createSession(workstreamId, options) {
        createdSessionNumber += 1
        const createdSessionId = sessionId(`workstream-session-${createdSessionNumber}`)
        workstreamsSnapshot = {
          revision: workstreamsSnapshot.revision + 1,
          workstreams: workstreamsSnapshot.workstreams.map((workstream) =>
            workstream.id === workstreamId
              ? {
                  ...workstream,
                  sessions: [
                    ...workstream.sessions,
                    {
                      id: createdSessionId,
                      workstreamId,
                      title: options.title?.trim() || 'New Session',
                      mode: options.mode,
                      availability: 'available' as const,
                      repositoryAccess: { kind: 'managed' as const },
                    },
                  ],
                }
              : workstream
          ),
        }

        return { status: 'available', sessionId: createdSessionId, snapshot: workstreamsSnapshot }
      },
      async getSessionForkPoints(sourceSessionId) {
        const userMessages = (transcriptsBySessionId[sourceSessionId]?.entries ?? []).flatMap((entry) =>
          entry.type === 'message' && entry.message.role === 'user' ? [entry.message] : []
        )

        return userMessages.map((message, index) => ({
          entryId: message.id,
          text: message.text,
          position: index + 1,
          total: userMessages.length,
        }))
      },
      async forkSession(sourceSessionId, options) {
        const owner = workstreamsSnapshot.workstreams.find((workstream) =>
          workstream.sessions.some((session) => session.id === sourceSessionId)
        )
        const source = owner?.sessions.find((session) => session.id === sourceSessionId)
        const point = (await this.getSessionForkPoints(sourceSessionId)).find(
          (candidate) => candidate.entryId === options.entryId
        )
        if (!owner || !source || !point) throw new TypeError('Select a user message from the Session history.')

        createdSessionNumber += 1
        const createdSessionId = sessionId(`forked-session-${createdSessionNumber}`)
        const target = { ...source, id: createdSessionId, title: options.title.trim() }

        if (source.mode === 'default') {
          const workstreamId = `forked-quick-workstream-${createdSessionNumber}`
          workstreamsSnapshot = {
            revision: workstreamsSnapshot.revision + 1,
            workstreams: [
              ...workstreamsSnapshot.workstreams,
              { ...owner, id: workstreamId, sessions: [{ ...target, workstreamId }] },
            ],
          }
        } else {
          workstreamsSnapshot = {
            revision: workstreamsSnapshot.revision + 1,
            workstreams: workstreamsSnapshot.workstreams.map((workstream) =>
              workstream.id === owner.id ? { ...workstream, sessions: [...workstream.sessions, target] } : workstream
            ),
          }
        }

        const sourceTranscript = transcriptsBySessionId[sourceSessionId]
        if (sourceTranscript) {
          let userPosition = 0
          transcriptsBySessionId[createdSessionId] = {
            ...sourceTranscript,
            sessionId: createdSessionId,
            entries: sourceTranscript.entries.filter((entry) => {
              if (entry.type !== 'message' || entry.message.role !== 'user') return userPosition < point.position
              userPosition += 1
              return userPosition < point.position
            }),
          }
        }

        return {
          status: 'available',
          sessionId: createdSessionId,
          snapshot: workstreamsSnapshot,
          draft: point.text,
        }
      },
      async setLifecycle(workstreamId, lifecycle) {
        workstreamsSnapshot = {
          revision: workstreamsSnapshot.revision + 1,
          workstreams: workstreamsSnapshot.workstreams.map((workstream) =>
            workstream.id === workstreamId ? { ...workstream, lifecycle } : workstream
          ),
        }

        return workstreamsSnapshot
      },
      async showWorkingLocation() {},
      async renameSession(ownedSessionId, title) {
        workstreamsSnapshot = {
          revision: workstreamsSnapshot.revision + 1,
          workstreams: workstreamsSnapshot.workstreams.map((workstream) => ({
            ...workstream,
            sessions: workstream.sessions.map((session) =>
              session.id === ownedSessionId ? { ...session, title } : session
            ),
          })),
        }

        return workstreamsSnapshot
      },
      subscribe() {
        return () => {}
      },
    },
    workstreamKnowledge: {
      async get(workstreamId) {
        const scenarioState = scenario.workstreamKnowledgesByWorkstreamId[workstreamId]
        if (scenarioState) return scenarioState

        const workstream = workstreamsSnapshot.workstreams.find((candidate) => candidate.id === workstreamId)
        if (!workstream?.goal) throw new Error('The goal-based Workstream knowledge no longer exists.')

        return createEmptyWorkstreamKnowledge(workstreamId, workstream.goal)
      },
      async mutate(workstreamId) {
        const knowledge = await this.get(workstreamId)

        return {
          knowledge,
          specificationReadiness: deriveWorkstreamKnowledgeReadiness(knowledge),
        }
      },
      subscribe() {
        return () => {}
      },
    },
    settings: {
      async getSnapshot() {
        return settingsSnapshot
      },
      async update(update) {
        const nextSettings = { ...settingsSnapshot, ...update }
        const usesDarkColors =
          nextSettings.appearance === 'system' ? colorSchemeMediaQuery.matches : nextSettings.appearance === 'dark'
        settingsSnapshot = createSettingsSnapshot(nextSettings, usesDarkColors)

        for (const listener of settingsListeners) {
          listener(settingsSnapshot)
        }

        return settingsSnapshot
      },
      subscribe(listener) {
        settingsListeners.add(listener)

        return () => settingsListeners.delete(listener)
      },
    },
  }
}
