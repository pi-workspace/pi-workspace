import type { WorkspaceRepositorySnapshot } from '@/src/application-state'
import type { PiWorkspaceBridge } from '@/src/pi-workspace'
import { createSettingsSnapshot, defaultSettings, type SettingsSnapshot } from '@/src/settings'
import { getDemoScenario } from '@/src/demo/demo-scenarios'
import { sessionId } from '@/src/domain/session'
import type { WorkstreamsSnapshot } from '@/src/domain/workstream'
import type { SessionTranscriptSnapshot } from '@/src/session-transcript'
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
  const settingsListeners = new Set<Parameters<PiWorkspaceBridge['settings']['subscribe']>[0]>()

  colorSchemeMediaQuery.addEventListener('change', (event) => {
    if (settingsSnapshot.appearance !== 'system') {
      return
    }

    settingsSnapshot = createSettingsSnapshot(defaultSettings, event.matches)

    for (const listener of settingsListeners) {
      listener(settingsSnapshot)
    }
  })

  const transcriptSnapshot = (requestedSessionId: string): SessionTranscriptSnapshot =>
    scenario.transcriptsBySessionId[requestedSessionId] ?? {
      sessionId: sessionId(requestedSessionId),
      revision: 0,
      isWorking: false,
      runs: [],
      entries: [],
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
      async submit() {
        return { status: 'rejected', reason: 'unexpected' }
      },
      async stop() {
        return { status: 'not-running' }
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
        return Object.values(scenario.transcriptsBySessionId).map(({ sessionId, revision, isWorking }) => ({
          sessionId,
          revision,
          isWorking,
        }))
      },
      async loadActivityDetails(sessionId, activityId) {
        return scenario.activityDetailsBySessionId[sessionId]?.[activityId]
      },
      async openExternalLink() {},
      subscribe() {
        return () => {}
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
            branch: `pi-workspace/${workstreamId}/${repository.id}`,
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
        const appearance = update.appearance ?? settingsSnapshot.appearance

        const usesDarkColors = appearance === 'system' ? colorSchemeMediaQuery.matches : appearance === 'dark'
        settingsSnapshot = createSettingsSnapshot({ appearance }, usesDarkColors)

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
