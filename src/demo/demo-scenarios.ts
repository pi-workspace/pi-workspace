import { sessionId, type SessionId } from '@/src/domain/session'
import type { OwnedSession, WorkstreamsSnapshot } from '@/src/domain/workstream'
import type { WorkstreamKnowledgeRecord } from '@/src/domain/workstream-knowledge'
import type { WorkstreamKnowledge } from '@/src/domain/workstream-knowledge-transitions'
import type { SessionTranscriptSnapshot } from '@/src/session-transcript'
import type { AgentActivityDetails } from '@/src/session-timeline'

export type DemoScenario = Readonly<{
  workstreams: WorkstreamsSnapshot
  transcriptsBySessionId: Readonly<Record<string, SessionTranscriptSnapshot>>
  activityDetailsBySessionId: Readonly<Record<string, Readonly<Record<string, AgentActivityDetails>>>>
  workstreamKnowledgesByWorkstreamId: Readonly<Record<string, WorkstreamKnowledge>>
}>

const completedRunSessionId = sessionId('northstar-release-overview')
const completedRunStartedAt = Date.UTC(2026, 6, 15, 9, 30)

function ownedSession(id: string, title: string): OwnedSession {
  return {
    id: sessionId(id),
    workstreamId: 'Product reliability',
    title,
    mode: 'implement',
    availability: 'available',
    repositoryAccess: { kind: 'managed' as const },
  }
}

function createEmptyScenario(sessionValues: ReadonlyArray<readonly [string, string]>): DemoScenario {
  const sessions = sessionValues.map(([id, title]) => ownedSession(id, title))
  const transcriptsBySessionId: Record<string, SessionTranscriptSnapshot> = {}

  for (const session of sessions) {
    transcriptsBySessionId[session.id] = {
      sessionId: session.id,
      revision: 0,
      isWorking: false,
      runs: [],
      entries: [],
    }
  }

  return {
    workstreams: {
      revision: 0,
      workstreams: [
        {
          id: 'Product reliability',
          workspaceId: 'Atlas Product',
          goal: 'Explore the Pi Workspace demo',
          lifecycle: 'active',
          workingLocation: 'current-checkouts',
          repositoryWorkingLocations: [],
          sessions,
        },
      ],
    },
    transcriptsBySessionId,
    activityDetailsBySessionId: {},
    workstreamKnowledgesByWorkstreamId: {},
  }
}

const workstreamGoal = 'Make offline editing reliable in Atlas Notes'
const brainstormSessionId = sessionId('offline-brainstorm')
const implementationSessionId = sessionId('offline-implementation')
const brainstormRunStartedAt = Date.UTC(2026, 6, 14, 14, 20)
const implementationRunStartedAt = Date.UTC(2026, 6, 15, 10, 15)
const brainstormRequest =
  'I’m building a note-taking app and want people to keep writing when their connection drops or they close the app mid-sync. Help me think through the experience, the risky edge cases, and a practical implementation plan.'
const brainstormResponse =
  'A local-first flow fits Atlas Notes well: save edits locally immediately, sync them from a durable queue, and make queued or conflicted notes visible without interrupting writing. I mapped the current save path, the main failure cases, and an implementation order that keeps recovery testable.'
const implementationRequest =
  'Let’s build the offline editing flow. Save every edit locally first, sync in the background with bounded retries, and show a clear status when a note is queued or needs attention.'
const implementationResponse =
  'Built the local-first editing flow with durable queued saves, background retries, and clear queued and conflict states. Added restart and recovery coverage, and the focused tests, typecheck, and lint all pass.'
const workstreamScenarioBase = createEmptyScenario([
  ['offline-brainstorm', 'Design the offline editing experience'],
  ['offline-implementation', 'Build reliable offline editing'],
])
const workstreamProvenance = {
  actor: 'pi',
  at: brainstormRunStartedAt,
  sessionId: brainstormSessionId,
} as const
const workstreamRecords: readonly WorkstreamKnowledgeRecord[] = [
  {
    id: 'save-flow-evidence',
    kind: 'evidence',
    source: {
      kind: 'repository',
      repositoryId: 'Atlas Notes',
      stale: false,
      origin: 'source-checkout',
      revision: 'main',
      path: 'src/notes/note-store.ts',
      symbol: 'saveNote',
      excerpt: 'Edits are persisted locally before the remote save begins.',
    },
    revision: 1,
    provenance: workstreamProvenance,
    tombstoned: false,
  },
  {
    id: 'offline-failure-finding',
    kind: 'finding',
    summary:
      'Local saves are reliable, but retries are not durable and queued or conflicted notes have no visible state.',
    repositoryIds: ['Atlas Notes'],
    evidenceIds: ['save-flow-evidence'],
    revision: 1,
    provenance: workstreamProvenance,
    tombstoned: false,
  },
  {
    id: 'local-first-decision',
    kind: 'decision',
    status: 'accepted',
    summary:
      'Keep writing local-first, sync from a durable queue, and require an explicit choice before resolving conflicts.',
    evidenceIds: ['save-flow-evidence'],
    revision: 2,
    provenance: { actor: 'user', at: brainstormRunStartedAt + 247_000, sessionId: brainstormSessionId },
    tombstoned: false,
  },
  {
    id: 'atlas-offline-impact',
    kind: 'repository-impact',
    repositoryId: 'Atlas Notes',
    classification: 'changed',
    summary: 'Add durable queued saves, background retry scheduling, and visible queued and conflict states.',
    evidenceIds: ['save-flow-evidence'],
    revision: 1,
    provenance: workstreamProvenance,
    tombstoned: false,
  },
  {
    id: 'retry-timing-question',
    kind: 'open-question',
    classification: 'non-blocking',
    status: 'open',
    summary: 'Should Atlas Notes show the next retry time or only the current sync state?',
    revision: 1,
    provenance: workstreamProvenance,
    tombstoned: false,
  },
  {
    id: 'build-offline-foundation',
    kind: 'plan-step',
    summary: 'Persist queued saves and process them with bounded background retries.',
    repositoryIds: ['Atlas Notes'],
    dependencyIds: [],
    evidenceIds: ['save-flow-evidence'],
    revision: 1,
    provenance: workstreamProvenance,
    tombstoned: false,
  },
  {
    id: 'surface-recovery-states',
    kind: 'plan-step',
    summary: 'Show queued and conflicted states in the editor with clear recovery actions.',
    repositoryIds: ['Atlas Notes'],
    dependencyIds: ['build-offline-foundation'],
    evidenceIds: ['save-flow-evidence'],
    revision: 1,
    provenance: workstreamProvenance,
    tombstoned: false,
  },
  {
    id: 'offline-validation',
    kind: 'validation-requirement',
    repositoryId: 'Atlas Notes',
    purpose: 'Protect edits through connection loss, retries, conflicts, and application restarts.',
    successCondition: 'Focused tests pass for enqueue, restart, retry, recovery, and conflict flows.',
    revision: 1,
    provenance: workstreamProvenance,
    tombstoned: false,
  },
]
const workstreamSpecification = {
  id: 'offline-editing-v1',
  workstreamId: 'Product reliability',
  version: 1,
  knowledgeRevision: 9,
  specificationRevision: 8,
  readiness: { ready: true, blockers: [] },
  records: workstreamRecords,
  approvedAt: brainstormRunStartedAt + 252_000,
} as const
const workstreamKnowledge: WorkstreamKnowledge = {
  workstreamId: 'Product reliability',
  goal: workstreamGoal,
  knowledgeRevision: 9,
  specificationRevision: 8,
  specificationVersion: 1,
  currentRepositoryIds: ['Atlas Notes'],
  records: workstreamRecords,
  specificationVersions: [workstreamSpecification],
  approvedVersion: workstreamSpecification,
}
const workstreamScenario: DemoScenario = {
  ...workstreamScenarioBase,
  workstreams: {
    revision: 0,
    workstreams: workstreamScenarioBase.workstreams.workstreams.map((workstream) => ({
      ...workstream,
      goal: workstreamGoal,
      sessions: workstream.sessions.map((session, index) => {
        if (index !== 0 || session.mode === 'default') return session

        return { ...session, mode: 'brainstorm' as const }
      }),
    })),
  },
  transcriptsBySessionId: {
    [brainstormSessionId]: {
      sessionId: brainstormSessionId,
      revision: 6,
      isWorking: false,
      runs: [
        {
          id: 'offline-brainstorm-run',
          initiatingMessageId: 'brainstorm-request',
          status: 'completed',
          activityIds: ['map-editing-flow', 'identify-offline-risks', 'shape-offline-plan'],
          startedAt: brainstormRunStartedAt,
          completedAt: brainstormRunStartedAt + 261_000,
        },
      ],
      entries: [
        {
          type: 'message',
          message: {
            id: 'brainstorm-request',
            role: 'user',
            text: brainstormRequest,
            state: 'complete',
            revision: 0,
          },
        },
        {
          type: 'activity',
          activity: {
            type: 'activity',
            id: 'map-editing-flow',
            runId: 'offline-brainstorm-run',
            kind: 'exploration',
            title: 'Mapped how Atlas Notes saves edits',
            summary: 'Traced local persistence, remote synchronization, and the editor’s current save states.',
            status: 'completed',
            operationCount: 3,
            fileCount: 3,
            secondaryLine: '3 files inspected',
            artifacts: [
              { type: 'inspected-file', path: 'src/notes/note-store.ts' },
              { type: 'inspected-file', path: 'src/notes/note-sync.ts' },
              { type: 'inspected-file', path: 'src/editor/save-status.tsx' },
            ],
            startedAt: brainstormRunStartedAt + 8_000,
            completedAt: brainstormRunStartedAt + 76_000,
          },
        },
        {
          type: 'activity',
          activity: {
            type: 'activity',
            id: 'identify-offline-risks',
            runId: 'offline-brainstorm-run',
            kind: 'research',
            title: 'Identified the risky offline transitions',
            summary: 'Covered connection loss, restart recovery, duplicate retries, and conflicting edits.',
            status: 'completed',
            operationCount: 3,
            fileCount: 2,
            secondaryLine: '4 failure paths mapped',
            artifacts: [
              { type: 'inspected-file', path: 'src/notes/note-sync.test.ts' },
              { type: 'inspected-file', path: 'src/storage/database.ts' },
            ],
            startedAt: brainstormRunStartedAt + 81_000,
            completedAt: brainstormRunStartedAt + 158_000,
          },
        },
        {
          type: 'activity',
          activity: {
            type: 'activity',
            id: 'shape-offline-plan',
            runId: 'offline-brainstorm-run',
            kind: 'planning',
            title: 'Shaped a local-first implementation plan',
            summary: 'Ordered durable queued saves before editor recovery states and defined focused validation.',
            status: 'completed',
            operationCount: 2,
            fileCount: 0,
            secondaryLine: '2 implementation steps',
            artifacts: [],
            startedAt: brainstormRunStartedAt + 164_000,
            completedAt: brainstormRunStartedAt + 247_000,
          },
        },
        {
          type: 'message',
          message: {
            id: 'brainstorm-response',
            role: 'assistant',
            text: brainstormResponse,
            state: 'complete',
            revision: 0,
          },
        },
      ],
    },
    [implementationSessionId]: {
      sessionId: implementationSessionId,
      revision: 6,
      isWorking: false,
      runs: [
        {
          id: 'offline-implementation-run',
          initiatingMessageId: 'implementation-request',
          status: 'completed',
          activityIds: ['inspect-save-pipeline', 'implement-offline-editing', 'validate-offline-editing'],
          startedAt: implementationRunStartedAt,
          completedAt: implementationRunStartedAt + 438_000,
        },
      ],
      entries: [
        {
          type: 'message',
          message: {
            id: 'implementation-request',
            role: 'user',
            text: implementationRequest,
            state: 'complete',
            revision: 0,
          },
        },
        {
          type: 'activity',
          activity: {
            type: 'activity',
            id: 'inspect-save-pipeline',
            runId: 'offline-implementation-run',
            kind: 'exploration',
            title: 'Mapped the existing save pipeline',
            summary: 'Confirmed the implementation seams for local writes, synchronization, and editor status.',
            status: 'completed',
            operationCount: 3,
            fileCount: 3,
            secondaryLine: '3 files inspected',
            artifacts: [
              { type: 'inspected-file', path: 'src/notes/note-store.ts' },
              { type: 'inspected-file', path: 'src/notes/note-sync.ts' },
              { type: 'inspected-file', path: 'src/editor/save-status.tsx' },
            ],
            startedAt: implementationRunStartedAt + 9_000,
            completedAt: implementationRunStartedAt + 82_000,
          },
        },
        {
          type: 'activity',
          activity: {
            type: 'activity',
            id: 'implement-offline-editing',
            runId: 'offline-implementation-run',
            kind: 'implementation',
            title: 'Built reliable offline editing',
            summary: 'Added durable queued saves, bounded retries, and visible queued and conflict states.',
            status: 'completed',
            operationCount: 4,
            fileCount: 4,
            secondaryLine: '4 files changed',
            artifacts: [
              { type: 'file-change', path: 'src/notes/offline-queue.ts', additions: 148 },
              { type: 'file-change', path: 'src/notes/note-sync.ts', additions: 64, deletions: 17 },
              { type: 'file-change', path: 'src/editor/save-status.tsx', additions: 53, deletions: 8 },
              { type: 'file-change', path: 'src/storage/schema.ts', additions: 24 },
            ],
            startedAt: implementationRunStartedAt + 88_000,
            completedAt: implementationRunStartedAt + 326_000,
          },
        },
        {
          type: 'activity',
          activity: {
            type: 'activity',
            id: 'validate-offline-editing',
            runId: 'offline-implementation-run',
            kind: 'validation',
            title: 'Validated offline recovery',
            summary: 'Covered queued saves, retries, restarts, and conflicts before running the project checks.',
            status: 'completed',
            operationCount: 3,
            fileCount: 1,
            secondaryLine: '26 tests passed',
            artifacts: [
              { type: 'validation', label: 'Offline editing tests', status: 'completed', passed: 26, failed: 0 },
              { type: 'command', command: 'bun run typecheck', status: 'completed' },
              { type: 'command', command: 'bun run lint', status: 'completed' },
            ],
            startedAt: implementationRunStartedAt + 332_000,
            completedAt: implementationRunStartedAt + 427_000,
          },
        },
        {
          type: 'message',
          message: {
            id: 'implementation-response',
            role: 'assistant',
            text: implementationResponse,
            state: 'complete',
            revision: 0,
          },
        },
      ],
    },
  },
  activityDetailsBySessionId: {
    [brainstormSessionId]: {
      'map-editing-flow': {
        activityId: 'map-editing-flow',
        operations: [
          {
            toolCallId: 'read-note-store-brainstorm',
            label: 'Read local note storage',
            status: 'completed',
            input: '{"path":"src/notes/note-store.ts"}',
            output: 'Confirmed each edit is persisted locally before synchronization begins.',
            truncated: false,
          },
          {
            toolCallId: 'read-note-sync-brainstorm',
            label: 'Read note synchronization',
            status: 'completed',
            input: '{"path":"src/notes/note-sync.ts"}',
            output: 'Found immediate remote saves and retries that do not survive a restart.',
            truncated: false,
          },
          {
            toolCallId: 'read-save-status-brainstorm',
            label: 'Read editor save status',
            status: 'completed',
            input: '{"path":"src/editor/save-status.tsx"}',
            output: 'The editor currently distinguishes only saving and saved states.',
            truncated: false,
          },
        ],
      },
      'identify-offline-risks': {
        activityId: 'identify-offline-risks',
        operations: [
          {
            toolCallId: 'inspect-sync-tests',
            label: 'Review synchronization coverage',
            status: 'completed',
            input: '{"path":"src/notes/note-sync.test.ts"}',
            output: 'Mapped missing coverage for restart, duplicate retry, and conflict paths.',
            truncated: false,
          },
          {
            toolCallId: 'inspect-storage-transactions',
            label: 'Review storage transactions',
            status: 'completed',
            input: '{"path":"src/storage/database.ts"}',
            output: 'Located the transaction boundary needed for durable queued saves.',
            truncated: false,
          },
          {
            toolCallId: 'summarize-failure-paths',
            label: 'Summarize failure paths',
            status: 'completed',
            input: 'connection loss, restart, duplicate retry, conflict',
            output: 'Four failure paths were carried into the plan and validation requirements.',
            truncated: false,
          },
        ],
      },
      'shape-offline-plan': {
        activityId: 'shape-offline-plan',
        operations: [
          {
            toolCallId: 'draft-offline-plan',
            label: 'Draft implementation order',
            status: 'completed',
            input: 'Atlas Notes offline findings',
            output: 'Placed durable queued saves before editor recovery states.',
            truncated: false,
          },
          {
            toolCallId: 'define-offline-validation',
            label: 'Define validation requirements',
            status: 'completed',
            input: 'Atlas Notes offline plan',
            output: 'Required focused coverage for enqueue, retry, restart, recovery, and conflicts.',
            truncated: false,
          },
        ],
      },
    },
    [implementationSessionId]: {
      'inspect-save-pipeline': {
        activityId: 'inspect-save-pipeline',
        operations: [
          {
            toolCallId: 'read-note-store',
            label: 'Read local note store',
            status: 'completed',
            input: '{"path":"src/notes/note-store.ts"}',
            output: 'Confirmed the local write can atomically enqueue synchronization work.',
            truncated: false,
          },
          {
            toolCallId: 'read-note-sync',
            label: 'Read note synchronization',
            status: 'completed',
            input: '{"path":"src/notes/note-sync.ts"}',
            output: 'Located the retry and conflict handling boundaries.',
            truncated: false,
          },
          {
            toolCallId: 'read-save-status',
            label: 'Read editor save status',
            status: 'completed',
            input: '{"path":"src/editor/save-status.tsx"}',
            output: 'Located the UI seam for queued and conflict states.',
            truncated: false,
          },
        ],
      },
      'implement-offline-editing': {
        activityId: 'implement-offline-editing',
        operations: [
          {
            toolCallId: 'add-offline-queue',
            label: 'Add durable queued saves',
            status: 'completed',
            input: '{"path":"src/notes/offline-queue.ts"}',
            output: 'Added persistent queue operations and bounded retry scheduling.',
            truncated: false,
          },
          {
            toolCallId: 'connect-note-sync',
            label: 'Connect background synchronization',
            status: 'completed',
            input: '{"path":"src/notes/note-sync.ts"}',
            output: 'Processed queued saves in the background and recorded conflicts explicitly.',
            truncated: false,
          },
          {
            toolCallId: 'update-save-status',
            label: 'Add editor recovery states',
            status: 'completed',
            input: '{"path":"src/editor/save-status.tsx"}',
            output: 'Added queued and conflict states with clear recovery actions.',
            truncated: false,
          },
          {
            toolCallId: 'update-offline-schema',
            label: 'Update storage schema',
            status: 'completed',
            input: '{"path":"src/storage/schema.ts"}',
            output: 'Added queued save and conflict record tables.',
            truncated: false,
          },
        ],
      },
      'validate-offline-editing': {
        activityId: 'validate-offline-editing',
        operations: [
          {
            toolCallId: 'run-offline-tests',
            label: 'Run offline editing tests',
            status: 'completed',
            input: 'bun test src/notes/offline-editing.test.ts',
            output: '26 pass, 0 fail',
            truncated: false,
          },
          {
            toolCallId: 'run-offline-typecheck',
            label: 'Run type checking',
            status: 'completed',
            input: 'bun run typecheck',
            output: 'Type checking passed.',
            truncated: false,
          },
          {
            toolCallId: 'run-offline-lint',
            label: 'Run linting',
            status: 'completed',
            input: 'bun run lint',
            output: 'Linting passed.',
            truncated: false,
          },
        ],
      },
    },
  },
  workstreamKnowledgesByWorkstreamId: { 'Product reliability': workstreamKnowledge },
}

const startupScenario = createEmptyScenario([
  ['atlas-search', 'Improve note search'],
  ['atlas-shortcuts', 'Add keyboard shortcuts'],
  ['atlas-import', 'Review import flow'],
  ['northstar-dashboard', 'Polish project dashboard'],
  ['northstar-accessibility', 'Audit navigation accessibility'],
  ['northstar-release', 'Prepare release checklist'],
])

const completedRunScenario: DemoScenario = {
  ...createEmptyScenario([
    ['northstar-release-overview', 'Build release overview'],
    ['northstar-empty-states', 'Refine empty states'],
    ['northstar-mobile-nav', 'Review mobile navigation'],
    ['atlas-search', 'Improve note search'],
    ['atlas-import', 'Review import flow'],
  ]),
  transcriptsBySessionId: {
    [completedRunSessionId]: {
      sessionId: completedRunSessionId,
      revision: 6,
      isWorking: false,
      runs: [
        {
          id: 'release-run',
          initiatingMessageId: 'release-request',
          status: 'completed',
          activityIds: ['inspect-dashboard', 'implement-overview', 'validate-overview'],
          startedAt: completedRunStartedAt,
          completedAt: completedRunStartedAt + 312_000,
        },
      ],
      entries: [
        {
          type: 'message',
          message: {
            id: 'release-request',
            role: 'user',
            text: 'Add a release overview that helps the team see what is ready to ship and what still needs attention.',
            state: 'complete',
            revision: 0,
          },
        },
        {
          type: 'activity',
          activity: {
            type: 'activity',
            id: 'inspect-dashboard',
            runId: 'release-run',
            kind: 'exploration',
            title: 'Mapped the existing dashboard flow',
            summary: 'Reviewed the release data model and the dashboard composition.',
            status: 'completed',
            operationCount: 3,
            fileCount: 3,
            secondaryLine: '3 files inspected',
            artifacts: [
              { type: 'inspected-file', path: 'src/releases/release-summary.ts' },
              { type: 'inspected-file', path: 'src/dashboard/release-dashboard.tsx' },
            ],
            startedAt: completedRunStartedAt + 8_000,
            completedAt: completedRunStartedAt + 74_000,
          },
        },
        {
          type: 'activity',
          activity: {
            type: 'activity',
            id: 'implement-overview',
            runId: 'release-run',
            kind: 'implementation',
            title: 'Built the release overview',
            summary: 'Added readiness totals and accessible status groupings.',
            status: 'completed',
            operationCount: 2,
            fileCount: 2,
            secondaryLine: '2 files changed',
            artifacts: [
              { type: 'file-change', path: 'src/dashboard/release-overview.tsx', additions: 86 },
              { type: 'file-change', path: 'src/dashboard/release-overview.test.tsx', additions: 54 },
            ],
            startedAt: completedRunStartedAt + 78_000,
            completedAt: completedRunStartedAt + 236_000,
          },
        },
        {
          type: 'activity',
          activity: {
            type: 'activity',
            id: 'validate-overview',
            runId: 'release-run',
            kind: 'validation',
            title: 'Validated the release overview',
            summary: 'Focused tests, type checking, and linting all passed.',
            status: 'completed',
            operationCount: 3,
            fileCount: 0,
            secondaryLine: '18 tests passed',
            artifacts: [
              { type: 'validation', label: 'Release overview tests', status: 'completed', passed: 18, failed: 0 },
              { type: 'command', command: 'bun run typecheck', status: 'completed' },
              { type: 'command', command: 'bun run lint', status: 'completed' },
            ],
            startedAt: completedRunStartedAt + 241_000,
            completedAt: completedRunStartedAt + 301_000,
          },
        },
        {
          type: 'message',
          message: {
            id: 'release-response',
            role: 'assistant',
            text: 'Added the release overview with readiness totals, clear status labels, and focused tests for the new behavior. The validation suite passes.',
            state: 'complete',
            revision: 0,
          },
        },
      ],
    },
  },
  activityDetailsBySessionId: {
    [completedRunSessionId]: {
      'inspect-dashboard': {
        activityId: 'inspect-dashboard',
        operations: [
          {
            toolCallId: 'inspect-release-summary',
            label: 'Read release summary model',
            status: 'completed',
            input: '{"path":"src/releases/release-summary.ts"}',
            output: 'Mapped release readiness fields and status values.',
            truncated: false,
          },
          {
            toolCallId: 'inspect-dashboard-screen',
            label: 'Read release dashboard',
            status: 'completed',
            input: '{"path":"src/dashboard/release-dashboard.tsx"}',
            output: 'Located the overview insertion point.',
            truncated: false,
          },
          {
            toolCallId: 'inspect-dashboard-tests',
            label: 'Read dashboard tests',
            status: 'completed',
            input: '{"path":"src/dashboard/release-dashboard.test.tsx"}',
            output: 'Confirmed existing accessible-query conventions.',
            truncated: false,
          },
        ],
      },
      'implement-overview': {
        activityId: 'implement-overview',
        operations: [
          {
            toolCallId: 'edit-overview',
            label: 'Create release overview',
            status: 'completed',
            input: '{"path":"src/dashboard/release-overview.tsx"}',
            output: 'Created the release overview and readiness groups.',
            truncated: false,
          },
          {
            toolCallId: 'edit-overview-tests',
            label: 'Add release overview tests',
            status: 'completed',
            input: '{"path":"src/dashboard/release-overview.test.tsx"}',
            output: 'Added focused tests for readiness totals and labels.',
            truncated: false,
          },
        ],
      },
      'validate-overview': {
        activityId: 'validate-overview',
        operations: [
          {
            toolCallId: 'run-focused-tests',
            label: 'Run release overview tests',
            status: 'completed',
            input: 'bun test src/dashboard/release-overview.test.tsx',
            output: '18 pass, 0 fail',
            truncated: false,
          },
          {
            toolCallId: 'run-typecheck',
            label: 'Run type checking',
            status: 'completed',
            input: 'bun run typecheck',
            output: 'Type checking passed.',
            truncated: false,
          },
          {
            toolCallId: 'run-lint',
            label: 'Run linting',
            status: 'completed',
            input: 'bun run lint',
            output: 'Linting passed.',
            truncated: false,
          },
        ],
      },
    },
  },
}

const multiSessionScenario = createEmptyScenario([
  ['atlas-search', 'Improve note search'],
  ['atlas-shortcuts', 'Add keyboard shortcuts'],
  ['atlas-import', 'Review import flow'],
  ['atlas-sharing', 'Plan sharing permissions'],
  ['northstar-dashboard', 'Polish project dashboard'],
  ['northstar-accessibility', 'Audit navigation accessibility'],
  ['northstar-release', 'Prepare release checklist'],
  ['northstar-performance', 'Profile page transitions'],
  ['harbor-onboarding', 'Simplify onboarding'],
  ['harbor-notifications', 'Tune notification settings'],
  ['harbor-offline', 'Design offline recovery'],
])

const frontendQuickSessionId = sessionId('atlas-web-checkout')
const apiQuickSessionId = sessionId('atlas-api-checkout')
const quickSessionsStartedAt = Date.UTC(2026, 6, 16, 11, 5)

const quickSessionsScenario: DemoScenario = {
  workstreams: {
    revision: 0,
    workstreams: [
      {
        id: 'atlas-web-quick-session',
        workspaceId: 'Atlas Product',
        lifecycle: 'active',
        workingLocation: 'current-checkouts',
        repositoryWorkingLocations: [
          {
            repositoryId: 'Atlas Web',
            repositoryName: 'Atlas Web',
            kind: 'current-checkout',
            availability: 'available',
            workingPath: '/Users/maya/Projects/atlas-web',
          },
        ],
        sessions: [
          {
            id: frontendQuickSessionId,
            workstreamId: 'atlas-web-quick-session',
            title: 'Build the order tracking page',
            mode: 'default',
            availability: 'available',
            repositoryAccess: {
              kind: 'direct',
              repositoryId: 'Atlas Web',
              repositoryName: 'Atlas Web',
              availability: 'available',
            },
          },
        ],
      },
      {
        id: 'atlas-api-quick-session',
        workspaceId: 'Atlas Product',
        lifecycle: 'active',
        workingLocation: 'current-checkouts',
        repositoryWorkingLocations: [
          {
            repositoryId: 'Atlas API',
            repositoryName: 'Atlas API',
            kind: 'current-checkout',
            availability: 'available',
            workingPath: '/Users/maya/Projects/atlas-api',
          },
        ],
        sessions: [
          {
            id: apiQuickSessionId,
            workstreamId: 'atlas-api-quick-session',
            title: 'Add live order status events',
            mode: 'default',
            availability: 'available',
            repositoryAccess: {
              kind: 'direct',
              repositoryId: 'Atlas API',
              repositoryName: 'Atlas API',
              availability: 'available',
            },
          },
        ],
      },
    ],
  },
  transcriptsBySessionId: {
    [frontendQuickSessionId]: {
      sessionId: frontendQuickSessionId,
      revision: 10,
      isWorking: false,
      runs: [
        {
          id: 'frontend-build-run',
          initiatingMessageId: 'frontend-request',
          status: 'completed',
          activityIds: ['inspect-web-app', 'build-tracking-page', 'validate-tracking-page'],
          startedAt: quickSessionsStartedAt,
          completedAt: quickSessionsStartedAt + 384_000,
        },
        {
          id: 'frontend-reconnect-run',
          initiatingMessageId: 'frontend-follow-up',
          status: 'completed',
          activityIds: ['refine-reconnect-state', 'validate-reconnect-state'],
          startedAt: quickSessionsStartedAt + 540_000,
          completedAt: quickSessionsStartedAt + 724_000,
        },
      ],
      entries: [
        {
          type: 'message',
          message: {
            id: 'frontend-request',
            role: 'user',
            text: 'Build an order tracking page in the Next.js app. It should show the current delivery step, a compact timeline, and update without a refresh when the API publishes a status event.',
            state: 'complete',
            revision: 0,
          },
        },
        {
          type: 'activity',
          activity: {
            type: 'activity',
            id: 'inspect-web-app',
            runId: 'frontend-build-run',
            kind: 'exploration',
            title: 'Mapped the Next.js order experience',
            summary: 'Traced the order route, shared status types, and the existing authenticated fetch client.',
            status: 'completed',
            operationCount: 4,
            fileCount: 4,
            secondaryLine: '4 files inspected',
            artifacts: [
              { type: 'inspected-file', path: 'app/orders/[orderId]/page.tsx' },
              { type: 'inspected-file', path: 'lib/api/orders.ts' },
            ],
            startedAt: quickSessionsStartedAt + 7_000,
            completedAt: quickSessionsStartedAt + 71_000,
          },
        },
        {
          type: 'activity',
          activity: {
            type: 'activity',
            id: 'build-tracking-page',
            runId: 'frontend-build-run',
            kind: 'implementation',
            title: 'Built live order tracking',
            summary: 'Added the progress timeline, reconnecting event stream, and resilient loading and empty states.',
            status: 'completed',
            operationCount: 5,
            fileCount: 5,
            secondaryLine: '5 files changed',
            artifacts: [
              { type: 'file-change', path: 'app/orders/[orderId]/tracking-page.tsx', additions: 184 },
              { type: 'file-change', path: 'hooks/use-order-events.ts', additions: 112 },
              { type: 'file-change', path: 'components/order-status-timeline.tsx', additions: 96 },
            ],
            startedAt: quickSessionsStartedAt + 77_000,
            completedAt: quickSessionsStartedAt + 291_000,
          },
        },
        {
          type: 'activity',
          activity: {
            type: 'activity',
            id: 'validate-tracking-page',
            runId: 'frontend-build-run',
            kind: 'validation',
            title: 'Validated the tracking experience',
            summary: 'Covered status progression, reconnects, keyboard navigation, and narrow layouts.',
            status: 'completed',
            operationCount: 3,
            fileCount: 2,
            secondaryLine: '31 tests passed',
            artifacts: [
              { type: 'validation', label: 'Order tracking tests', status: 'completed', passed: 31, failed: 0 },
              { type: 'command', command: 'bun run typecheck', status: 'completed' },
            ],
            startedAt: quickSessionsStartedAt + 298_000,
            completedAt: quickSessionsStartedAt + 371_000,
          },
        },
        {
          type: 'message',
          message: {
            id: 'frontend-response',
            role: 'assistant',
            text: 'Implemented the tracking route with an accessible progress timeline, responsive loading and empty states, and a reconnecting event stream hook. The focused component and hook tests pass.',
            state: 'complete',
            revision: 0,
          },
        },
        {
          type: 'message',
          message: {
            id: 'frontend-follow-up',
            role: 'user',
            text: 'Please make the connection state subtle. Keep the last known status visible during a reconnect and only show an alert if updates have been unavailable for more than 10 seconds.',
            state: 'complete',
            revision: 0,
          },
        },
        {
          type: 'activity',
          activity: {
            type: 'activity',
            id: 'refine-reconnect-state',
            runId: 'frontend-reconnect-run',
            kind: 'implementation',
            title: 'Refined reconnect feedback',
            summary:
              'Kept the last known status visible and delayed the connection warning to avoid unnecessary interruption.',
            status: 'completed',
            operationCount: 3,
            fileCount: 2,
            secondaryLine: '2 files changed',
            artifacts: [
              { type: 'file-change', path: 'hooks/use-order-events.ts', additions: 38, deletions: 12 },
              { type: 'file-change', path: 'app/orders/[orderId]/tracking-page.tsx', additions: 27, deletions: 6 },
            ],
            startedAt: quickSessionsStartedAt + 548_000,
            completedAt: quickSessionsStartedAt + 643_000,
          },
        },
        {
          type: 'activity',
          activity: {
            type: 'activity',
            id: 'validate-reconnect-state',
            runId: 'frontend-reconnect-run',
            kind: 'validation',
            title: 'Tested delayed connection warnings',
            summary: 'Verified short reconnects stay quiet and longer outages announce once before recovering.',
            status: 'completed',
            operationCount: 2,
            fileCount: 1,
            secondaryLine: '8 tests passed',
            artifacts: [
              { type: 'validation', label: 'Reconnect state tests', status: 'completed', passed: 8, failed: 0 },
            ],
            startedAt: quickSessionsStartedAt + 650_000,
            completedAt: quickSessionsStartedAt + 714_000,
          },
        },
        {
          type: 'message',
          message: {
            id: 'frontend-follow-up-response',
            role: 'assistant',
            text: 'Adjusted reconnect handling to preserve the last status, added a delayed live-region warning, and covered recovery before and after the 10-second threshold.',
            state: 'complete',
            revision: 0,
          },
        },
      ],
    },
    [apiQuickSessionId]: {
      sessionId: apiQuickSessionId,
      revision: 10,
      isWorking: false,
      runs: [
        {
          id: 'api-events-run',
          initiatingMessageId: 'api-request',
          status: 'completed',
          activityIds: ['inspect-api-events', 'implement-order-events', 'validate-order-events'],
          startedAt: quickSessionsStartedAt + 42_000,
          completedAt: quickSessionsStartedAt + 461_000,
        },
        {
          id: 'api-contract-run',
          initiatingMessageId: 'api-follow-up',
          status: 'completed',
          activityIds: ['document-event-contract', 'verify-client-cleanup'],
          startedAt: quickSessionsStartedAt + 612_000,
          completedAt: quickSessionsStartedAt + 803_000,
        },
      ],
      entries: [
        {
          type: 'message',
          message: {
            id: 'api-request',
            role: 'user',
            text: 'Add a Fastify endpoint that streams order status changes to the web app. Reuse our order authorization and make reconnects resume from the last event instead of replaying the full history.',
            state: 'complete',
            revision: 0,
          },
        },
        {
          type: 'activity',
          activity: {
            type: 'activity',
            id: 'inspect-api-events',
            runId: 'api-events-run',
            kind: 'exploration',
            title: 'Mapped order events and authorization',
            summary: 'Traced order ownership checks, event publication, and the Fastify route conventions.',
            status: 'completed',
            operationCount: 4,
            fileCount: 4,
            secondaryLine: '4 files inspected',
            artifacts: [
              { type: 'inspected-file', path: 'src/modules/orders/order-events.ts' },
              { type: 'inspected-file', path: 'src/modules/orders/order-authorization.ts' },
            ],
            startedAt: quickSessionsStartedAt + 49_000,
            completedAt: quickSessionsStartedAt + 118_000,
          },
        },
        {
          type: 'activity',
          activity: {
            type: 'activity',
            id: 'implement-order-events',
            runId: 'api-events-run',
            kind: 'implementation',
            title: 'Added resumable order events',
            summary: 'Built the authenticated SSE route with cursors, bounded history, heartbeats, and cleanup.',
            status: 'completed',
            operationCount: 6,
            fileCount: 5,
            secondaryLine: '5 files changed',
            artifacts: [
              { type: 'file-change', path: 'src/modules/orders/order-events.route.ts', additions: 173 },
              { type: 'file-change', path: 'src/modules/orders/order-event-store.ts', additions: 128 },
              { type: 'file-change', path: 'src/modules/orders/order-events.schema.ts', additions: 54 },
            ],
            startedAt: quickSessionsStartedAt + 124_000,
            completedAt: quickSessionsStartedAt + 348_000,
          },
        },
        {
          type: 'activity',
          activity: {
            type: 'activity',
            id: 'validate-order-events',
            runId: 'api-events-run',
            kind: 'validation',
            title: 'Validated event delivery and resume',
            summary: 'Covered authorization, cursor resume, heartbeat expiry, and client disconnect cleanup.',
            status: 'completed',
            operationCount: 3,
            fileCount: 2,
            secondaryLine: '24 integration tests passed',
            artifacts: [
              {
                type: 'validation',
                label: 'Order event integration tests',
                status: 'completed',
                passed: 24,
                failed: 0,
              },
              { type: 'command', command: 'bun run lint', status: 'completed' },
            ],
            startedAt: quickSessionsStartedAt + 354_000,
            completedAt: quickSessionsStartedAt + 449_000,
          },
        },
        {
          type: 'message',
          message: {
            id: 'api-response',
            role: 'assistant',
            text: 'Added an authenticated server-sent events route with cursor-based resume, heartbeat cleanup, and bounded per-order history. Integration tests cover authorization, reconnects, and closed clients.',
            state: 'complete',
            revision: 0,
          },
        },
        {
          type: 'message',
          message: {
            id: 'api-follow-up',
            role: 'user',
            text: 'Can you also document the event contract for the frontend and verify that a slow client cannot hold the order worker open?',
            state: 'complete',
            revision: 0,
          },
        },
        {
          type: 'activity',
          activity: {
            type: 'activity',
            id: 'document-event-contract',
            runId: 'api-contract-run',
            kind: 'implementation',
            title: 'Published the frontend event contract',
            summary: 'Documented event names, payloads, cursor behavior, heartbeats, and terminal states.',
            status: 'completed',
            operationCount: 2,
            fileCount: 2,
            secondaryLine: '2 files changed',
            artifacts: [
              { type: 'file-change', path: 'docs/order-events.md', additions: 94 },
              { type: 'file-change', path: 'src/modules/orders/order-events.schema.ts', additions: 22, deletions: 4 },
            ],
            startedAt: quickSessionsStartedAt + 620_000,
            completedAt: quickSessionsStartedAt + 698_000,
          },
        },
        {
          type: 'activity',
          activity: {
            type: 'activity',
            id: 'verify-client-cleanup',
            runId: 'api-contract-run',
            kind: 'validation',
            title: 'Verified slow-client cleanup',
            summary: 'Added backpressure coverage and confirmed timeout and disconnect paths release subscriptions.',
            status: 'completed',
            operationCount: 3,
            fileCount: 1,
            secondaryLine: '7 cleanup tests passed',
            artifacts: [
              { type: 'validation', label: 'SSE cleanup tests', status: 'completed', passed: 7, failed: 0 },
              { type: 'command', command: 'bun test src/modules/orders/order-events.test.ts', status: 'completed' },
            ],
            startedAt: quickSessionsStartedAt + 705_000,
            completedAt: quickSessionsStartedAt + 792_000,
          },
        },
        {
          type: 'message',
          message: {
            id: 'api-follow-up-response',
            role: 'assistant',
            text: 'Documented the event names and payloads, added backpressure-aware writes, and verified that disconnect and timeout paths release subscriptions promptly.',
            state: 'complete',
            revision: 0,
          },
        },
      ],
    },
  },
  activityDetailsBySessionId: {},
  workstreamKnowledgesByWorkstreamId: {},
}

export type DemoScenarioPresentation = Readonly<{
  activeSessionId: SessionId
  pinnedSessionIds: readonly SessionId[]
}>

const quickSessionsPresentation: DemoScenarioPresentation = {
  activeSessionId: apiQuickSessionId,
  pinnedSessionIds: [frontendQuickSessionId, apiQuickSessionId],
}

const scenarios: Readonly<Record<string, DemoScenario>> = {
  startup: startupScenario,
  workstream: workstreamScenario,
  'completed-run': completedRunScenario,
  'multi-session': multiSessionScenario,
  'quick-sessions': quickSessionsScenario,
}

export function getDemoScenario(name: string | undefined): DemoScenario {
  return scenarios[name ?? 'startup'] ?? startupScenario
}

export function getDemoScenarioPresentation(name: string | undefined): DemoScenarioPresentation | undefined {
  return name === 'quick-sessions' ? quickSessionsPresentation : undefined
}
