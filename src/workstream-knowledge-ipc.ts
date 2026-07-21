import type {
  WorkstreamKnowledge,
  WorkstreamKnowledgeCommand,
  WorkstreamKnowledgeMutationResult,
} from '@/src/domain/workstream-knowledge-transitions'
import type { WorkstreamKnowledgeRecordDraft } from '@/src/domain/workstream-knowledge'

export const workstreamKnowledgeIpcChannels = {
  get: 'workstream-knowledge:get',
  mutate: 'workstream-knowledge:mutate',
  changed: 'workstream-knowledge:changed',
} as const

export interface WorkstreamKnowledgeBridge {
  get(workstreamId: string): Promise<WorkstreamKnowledge>
  mutate(workstreamId: string, command: WorkstreamKnowledgeCommand): Promise<WorkstreamKnowledgeMutationResult>
  subscribe(listener: (state: WorkstreamKnowledge) => void): () => void
}

export interface WorkstreamKnowledgeAuthority {
  getWorkstreamKnowledge(workstreamId: string): Promise<WorkstreamKnowledge>
  applyUserWorkstreamKnowledgeCommand(
    workstreamId: string,
    command: WorkstreamKnowledgeCommand
  ): Promise<WorkstreamKnowledgeMutationResult>
  subscribeWorkstreamKnowledge(listener: (state: WorkstreamKnowledge) => void): () => void
}

export function createWorkstreamKnowledgeIpcHandlers(authority: WorkstreamKnowledgeAuthority) {
  return {
    get(workstreamId: unknown) {
      return typeof workstreamId === 'string' && workstreamId.length > 0
        ? authority.getWorkstreamKnowledge(workstreamId)
        : Promise.reject(new TypeError('A Workstream is required.'))
    },
    mutate(workstreamId: unknown, value: unknown) {
      const command = parseWorkstreamKnowledgeCommand(value)

      return typeof workstreamId === 'string' && workstreamId.length > 0 && command
        ? authority.applyUserWorkstreamKnowledgeCommand(workstreamId, command)
        : Promise.reject(new TypeError('A valid Workstream knowledge command is required.'))
    },
  }
}

export function parseWorkstreamKnowledgeCommand(value: unknown): WorkstreamKnowledgeCommand | undefined {
  if (typeof value !== 'object' || value === null) return undefined

  const command = value as Record<string, unknown>
  const expectedKnowledgeRevision = command.expectedKnowledgeRevision
  if (
    typeof expectedKnowledgeRevision !== 'number' ||
    !Number.isInteger(expectedKnowledgeRevision) ||
    expectedKnowledgeRevision < 0
  ) {
    return undefined
  }

  if (
    command.type === 'tombstone-record' ||
    command.type === 'accept-decision' ||
    command.type === 'supersede-decision' ||
    command.type === 'accept-assumption'
  ) {
    const expectedRecordRevision = parseRevision(command.expectedRecordRevision)

    return typeof command.recordId === 'string' && command.recordId.length > 0 && expectedRecordRevision !== undefined
      ? { type: command.type, expectedKnowledgeRevision, expectedRecordRevision, recordId: command.recordId }
      : undefined
  }

  if (command.type === 'approve-specification') {
    return typeof command.versionId === 'string' &&
      command.versionId.length > 0 &&
      typeof command.approvedAt === 'number' &&
      Number.isFinite(command.approvedAt)
      ? { type: command.type, expectedKnowledgeRevision, versionId: command.versionId, approvedAt: command.approvedAt }
      : undefined
  }

  if (command.type !== 'put-record') return undefined
  const expectedRecordRevision = parseRevision(command.expectedRecordRevision)
  const record = parseRecordDraft(command.record)

  return record && expectedRecordRevision !== undefined
    ? { type: 'put-record', expectedKnowledgeRevision, expectedRecordRevision, record }
    : undefined
}

function parseRevision(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined
}

function parseRecordDraft(value: unknown): WorkstreamKnowledgeRecordDraft | undefined {
  if (typeof value !== 'object' || value === null) return undefined

  const record = value as Record<string, unknown>
  if (typeof record.id !== 'string' || record.id.length === 0 || typeof record.kind !== 'string') return undefined

  if (record.kind === 'evidence') {
    const source = record.source
    if (typeof source !== 'object' || source === null) return undefined

    const sourceRecord = source as Record<string, unknown>
    if (sourceRecord.kind === 'user-message' && typeof sourceRecord.messageId === 'string' && sourceRecord.messageId) {
      return { id: record.id, kind: 'evidence', source: { kind: 'user-message', messageId: sourceRecord.messageId } }
    }
    const origin =
      sourceRecord.origin === 'source-checkout' || sourceRecord.origin === 'workstream-worktree'
        ? sourceRecord.origin
        : undefined
    const lineRange = parseLineRange(sourceRecord.lineRange)
    const validLineRange = sourceRecord.lineRange === undefined || lineRange !== undefined
    const excerpt = typeof sourceRecord.excerpt === 'string' && sourceRecord.excerpt ? sourceRecord.excerpt : undefined
    const toolResultId =
      typeof sourceRecord.toolResultId === 'string' && sourceRecord.toolResultId ? sourceRecord.toolResultId : undefined
    if (
      sourceRecord.kind === 'repository' &&
      typeof sourceRecord.repositoryId === 'string' &&
      sourceRecord.repositoryId &&
      typeof sourceRecord.stale === 'boolean' &&
      origin &&
      typeof sourceRecord.path === 'string' &&
      sourceRecord.path &&
      validLineRange &&
      (excerpt || toolResultId)
    ) {
      const support = excerpt ? { excerpt, ...(toolResultId ? { toolResultId } : {}) } : { toolResultId: toolResultId! }

      return {
        id: record.id,
        kind: 'evidence',
        source: {
          kind: 'repository',
          repositoryId: sourceRecord.repositoryId,
          stale: sourceRecord.stale,
          origin,
          path: sourceRecord.path,
          ...(typeof sourceRecord.revision === 'string' ? { revision: sourceRecord.revision } : {}),
          ...(typeof sourceRecord.symbol === 'string' ? { symbol: sourceRecord.symbol } : {}),
          ...(lineRange ? { lineRange } : {}),
          ...support,
        },
      }
    }

    return undefined
  }

  if (record.kind === 'finding') {
    return typeof record.summary === 'string' &&
      isStringArray(record.repositoryIds) &&
      isStringArray(record.evidenceIds) &&
      isOptionalStringArray(record.assumptionIds)
      ? {
          id: record.id,
          kind: 'finding',
          summary: record.summary,
          repositoryIds: record.repositoryIds,
          evidenceIds: record.evidenceIds,
          ...(record.assumptionIds ? { assumptionIds: record.assumptionIds } : {}),
        }
      : undefined
  }

  if (record.kind === 'decision' || record.kind === 'assumption') {
    const statuses = record.kind === 'decision' ? ['proposed', 'accepted', 'superseded'] : ['proposed', 'accepted']
    return typeof record.summary === 'string' &&
      typeof record.status === 'string' &&
      statuses.includes(record.status) &&
      isStringArray(record.evidenceIds) &&
      isOptionalStringArray(record.assumptionIds)
      ? ({
          id: record.id,
          kind: record.kind,
          status: record.status,
          summary: record.summary,
          evidenceIds: record.evidenceIds,
          ...(record.assumptionIds ? { assumptionIds: record.assumptionIds } : {}),
        } as WorkstreamKnowledgeRecordDraft)
      : undefined
  }

  if (record.kind === 'open-question') {
    return (record.classification === 'blocking' || record.classification === 'non-blocking') &&
      (record.status === 'open' || record.status === 'resolved') &&
      typeof record.summary === 'string' &&
      (record.resolutionAssumptionId === undefined || typeof record.resolutionAssumptionId === 'string')
      ? {
          id: record.id,
          kind: 'open-question',
          classification: record.classification,
          status: record.status,
          summary: record.summary,
          ...(record.resolutionAssumptionId ? { resolutionAssumptionId: record.resolutionAssumptionId } : {}),
        }
      : undefined
  }

  if (record.kind === 'repository-impact') {
    return typeof record.repositoryId === 'string' &&
      (record.classification === 'changed' || record.classification === 'unaffected') &&
      typeof record.summary === 'string' &&
      isStringArray(record.evidenceIds) &&
      isOptionalStringArray(record.assumptionIds)
      ? {
          id: record.id,
          kind: 'repository-impact',
          repositoryId: record.repositoryId,
          classification: record.classification,
          summary: record.summary,
          evidenceIds: record.evidenceIds,
          ...(record.assumptionIds ? { assumptionIds: record.assumptionIds } : {}),
        }
      : undefined
  }

  if (record.kind === 'plan-step') {
    return typeof record.summary === 'string' &&
      isStringArray(record.repositoryIds) &&
      isStringArray(record.dependencyIds) &&
      isStringArray(record.evidenceIds) &&
      isOptionalStringArray(record.assumptionIds)
      ? {
          id: record.id,
          kind: 'plan-step',
          summary: record.summary,
          repositoryIds: record.repositoryIds,
          dependencyIds: record.dependencyIds,
          evidenceIds: record.evidenceIds,
          ...(record.assumptionIds ? { assumptionIds: record.assumptionIds } : {}),
        }
      : undefined
  }

  if (record.kind === 'validation-requirement') {
    return typeof record.repositoryId === 'string' &&
      typeof record.purpose === 'string' &&
      typeof record.successCondition === 'string'
      ? {
          id: record.id,
          kind: 'validation-requirement',
          repositoryId: record.repositoryId,
          purpose: record.purpose,
          successCondition: record.successCondition,
        }
      : undefined
  }

  if (record.kind === 'execution-progress') {
    const statuses = ['pending', 'in-progress', 'blocked', 'complete']
    return isStringArray(record.repositoryIds) &&
      statuses.includes(String(record.status)) &&
      typeof record.summary === 'string' &&
      (record.planStepId === undefined || typeof record.planStepId === 'string')
      ? {
          id: record.id,
          kind: 'execution-progress',
          repositoryIds: record.repositoryIds,
          status: record.status as 'pending' | 'in-progress' | 'blocked' | 'complete',
          summary: record.summary,
          ...(record.planStepId ? { planStepId: record.planStepId } : {}),
        }
      : undefined
  }

  return undefined
}

function parseLineRange(value: unknown): Readonly<{ start: number; end?: number }> | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'object' || value === null) return undefined

  const range = value as Record<string, unknown>
  if (typeof range.start !== 'number' || !Number.isInteger(range.start) || range.start < 1) return undefined
  if (
    range.end !== undefined &&
    (typeof range.end !== 'number' || !Number.isInteger(range.end) || range.end < range.start)
  ) {
    return undefined
  }

  return { start: range.start, ...(typeof range.end === 'number' ? { end: range.end } : {}) }
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

function isOptionalStringArray(value: unknown): value is readonly string[] | undefined {
  return value === undefined || isStringArray(value)
}
