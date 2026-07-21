import {
  deriveSpecificationReadiness,
  deriveSpecificationSourceRecords,
  type SpecificationReadiness,
  type WorkstreamAssumption,
  type WorkstreamDecision,
  type WorkstreamKnowledgeActor,
  type WorkstreamKnowledgeRecord,
  type WorkstreamKnowledgeRecordDraft,
  type WorkstreamKnowledgeProvenance,
} from './workstream-knowledge'

export type SpecificationVersion = Readonly<{
  id: string
  workstreamId: string
  version: number
  knowledgeRevision: number
  specificationRevision: number
  readiness: SpecificationReadiness
  records: readonly WorkstreamKnowledgeRecord[]
  approvedAt: number
}>

export type WorkstreamKnowledge = Readonly<{
  workstreamId: string
  goal: string
  knowledgeRevision: number
  specificationRevision: number
  specificationVersion: number
  currentRepositoryIds: readonly string[]
  records: readonly WorkstreamKnowledgeRecord[]
  specificationVersions: readonly SpecificationVersion[]
  approvedVersion?: SpecificationVersion
}>

export type WorkstreamKnowledgeCommand =
  | Readonly<{
      type: 'put-record'
      expectedKnowledgeRevision: number
      expectedRecordRevision: number
      record: WorkstreamKnowledgeRecordDraft
    }>
  | Readonly<{
      type: 'tombstone-record'
      expectedKnowledgeRevision: number
      expectedRecordRevision: number
      recordId: string
    }>
  | Readonly<{
      type: 'accept-decision'
      expectedKnowledgeRevision: number
      expectedRecordRevision: number
      recordId: string
    }>
  | Readonly<{
      type: 'supersede-decision'
      expectedKnowledgeRevision: number
      expectedRecordRevision: number
      recordId: string
    }>
  | Readonly<{
      type: 'accept-assumption'
      expectedKnowledgeRevision: number
      expectedRecordRevision: number
      recordId: string
    }>
  | Readonly<{
      type: 'approve-specification'
      expectedKnowledgeRevision: number
      versionId: string
      approvedAt: number
    }>

export type WorkstreamKnowledgeCommandContext = Readonly<{
  actor: WorkstreamKnowledgeActor
  at: number
  sessionId?: string
}>

export type WorkstreamKnowledgeMutationResult = Readonly<{
  knowledge: WorkstreamKnowledge
  changedRecordId?: string
  specificationReadiness: SpecificationReadiness
}>

export function createEmptyWorkstreamKnowledge(
  workstreamId: string,
  goal: string,
  currentRepositoryIds: readonly string[] = []
): WorkstreamKnowledge {
  return {
    workstreamId,
    goal,
    knowledgeRevision: 0,
    specificationRevision: 0,
    specificationVersion: 0,
    currentRepositoryIds,
    records: [],
    specificationVersions: [],
  }
}

function provenance(context: WorkstreamKnowledgeCommandContext): WorkstreamKnowledgeProvenance {
  return {
    actor: context.actor,
    at: context.at,
    ...(context.sessionId ? { sessionId: context.sessionId } : {}),
  }
}

function currentRecords(knowledge: WorkstreamKnowledge): readonly WorkstreamKnowledgeRecord[] {
  return knowledge.records.filter((record) => !record.tombstoned)
}

function findCurrentRecord(knowledge: WorkstreamKnowledge, recordId: string): WorkstreamKnowledgeRecord {
  const record = knowledge.records.find((candidate) => candidate.id === recordId && !candidate.tombstoned)
  if (!record) throw new TypeError('The Workstream record no longer exists.')

  return record
}

function requireUser(context: WorkstreamKnowledgeCommandContext): void {
  if (context.actor !== 'user') throw new TypeError('This Workstream knowledge transition is user-only.')
}

function requireExpectedRevision(knowledge: WorkstreamKnowledge, expectedKnowledgeRevision: number): void {
  if (knowledge.knowledgeRevision !== expectedKnowledgeRevision) {
    throw new Error(`The Workstream knowledge is stale. Expected revision ${expectedKnowledgeRevision}.`)
  }
}

function requireExpectedRecordRevision(
  record: WorkstreamKnowledgeRecord | undefined,
  expectedRecordRevision: number
): void {
  const currentRevision = record?.revision ?? 0

  if (currentRevision !== expectedRecordRevision) {
    throw new Error(`The Workstream record is stale. Expected revision ${expectedRecordRevision}.`)
  }
}

function withStateMutation(
  knowledge: WorkstreamKnowledge,
  records: readonly WorkstreamKnowledgeRecord[],
  specificationRelevant: boolean,
  changedRecordId?: string
): WorkstreamKnowledgeMutationResult {
  const nextState: WorkstreamKnowledge = {
    ...knowledge,
    knowledgeRevision: knowledge.knowledgeRevision + 1,
    specificationRevision: knowledge.specificationRevision + (specificationRelevant ? 1 : 0),
    records,
    ...(specificationRelevant ? { approvedVersion: undefined } : {}),
  }

  return {
    knowledge: nextState,
    changedRecordId,
    specificationReadiness: deriveWorkstreamKnowledgeReadiness(nextState),
  }
}

export function deriveWorkstreamKnowledgeReadiness(knowledge: WorkstreamKnowledge): SpecificationReadiness {
  const repositoryIds = [
    ...knowledge.currentRepositoryIds,
    ...currentRecords(knowledge).flatMap((record) =>
      record.kind === 'repository-impact' ? [record.repositoryId] : []
    ),
  ]

  return deriveSpecificationReadiness({
    goal: knowledge.goal,
    repositoryIds: [...new Set(repositoryIds)],
    records: knowledge.records,
  })
}

function updateDecision(
  knowledge: WorkstreamKnowledge,
  recordId: string,
  expectedRecordRevision: number,
  status: WorkstreamDecision['status'],
  context: WorkstreamKnowledgeCommandContext
): WorkstreamKnowledgeMutationResult {
  const record = findCurrentRecord(knowledge, recordId)
  requireExpectedRecordRevision(record, expectedRecordRevision)
  if (record.kind !== 'decision') throw new TypeError('The Workstream record is not a decision.')
  if (status === 'accepted' && record.status !== 'proposed') {
    throw new TypeError('Only a proposed decision can be accepted.')
  }
  if (status === 'superseded' && record.status !== 'accepted') {
    throw new TypeError('Only an accepted decision can be superseded.')
  }

  const updatedRecord: WorkstreamDecision = {
    ...record,
    status,
    revision: record.revision + 1,
    provenance: provenance(context),
  }
  const records = knowledge.records.map((candidate) => (candidate.id === recordId ? updatedRecord : candidate))

  return withStateMutation(knowledge, records, true, recordId)
}

function updateAssumption(
  knowledge: WorkstreamKnowledge,
  recordId: string,
  expectedRecordRevision: number,
  context: WorkstreamKnowledgeCommandContext
): WorkstreamKnowledgeMutationResult {
  const record = findCurrentRecord(knowledge, recordId)
  requireExpectedRecordRevision(record, expectedRecordRevision)
  if (record.kind !== 'assumption') throw new TypeError('The Workstream record is not an assumption.')
  if (record.status !== 'proposed') throw new TypeError('Only a proposed assumption can be accepted.')

  const updatedRecord: WorkstreamAssumption = {
    ...record,
    status: 'accepted',
    revision: record.revision + 1,
    provenance: provenance(context),
  }
  const records = knowledge.records.map((candidate) => (candidate.id === recordId ? updatedRecord : candidate))

  return withStateMutation(knowledge, records, true, recordId)
}

export function applyWorkstreamKnowledgeCommand(
  knowledge: WorkstreamKnowledge,
  command: WorkstreamKnowledgeCommand,
  context: WorkstreamKnowledgeCommandContext
): WorkstreamKnowledgeMutationResult {
  requireExpectedRevision(knowledge, command.expectedKnowledgeRevision)

  if (command.type === 'approve-specification') {
    requireUser(context)
    const currentReadiness = deriveWorkstreamKnowledgeReadiness(knowledge)
    if (!currentReadiness.ready) throw new TypeError('The Workstream specification is not ready for approval.')

    const version: SpecificationVersion = {
      id: command.versionId,
      workstreamId: knowledge.workstreamId,
      version: knowledge.specificationVersion + 1,
      knowledgeRevision: knowledge.knowledgeRevision,
      specificationRevision: knowledge.specificationRevision,
      readiness: currentReadiness,
      records: deriveSpecificationSourceRecords(knowledge.records).map((record) => ({ ...record })),
      approvedAt: command.approvedAt,
    }
    const nextState = {
      ...knowledge,
      knowledgeRevision: knowledge.knowledgeRevision + 1,
      specificationVersion: version.version,
      specificationVersions: [...knowledge.specificationVersions, version],
      approvedVersion: version,
    }

    return { knowledge: nextState, specificationReadiness: currentReadiness }
  }

  if (command.type === 'accept-decision') {
    requireUser(context)
    return updateDecision(knowledge, command.recordId, command.expectedRecordRevision, 'accepted', context)
  }

  if (command.type === 'supersede-decision') {
    requireUser(context)
    return updateDecision(knowledge, command.recordId, command.expectedRecordRevision, 'superseded', context)
  }

  if (command.type === 'accept-assumption') {
    requireUser(context)
    return updateAssumption(knowledge, command.recordId, command.expectedRecordRevision, context)
  }

  if (command.type === 'tombstone-record') {
    const record = findCurrentRecord(knowledge, command.recordId)
    requireExpectedRecordRevision(record, command.expectedRecordRevision)
    if (
      context.actor === 'pi' &&
      ((record.kind === 'decision' && record.status !== 'proposed') ||
        (record.kind === 'assumption' && record.status !== 'proposed'))
    ) {
      throw new TypeError('Pi cannot remove accepted or superseded decisions or assumptions.')
    }

    const updatedRecord = {
      ...record,
      revision: record.revision + 1,
      provenance: provenance(context),
      tombstoned: true,
    } as WorkstreamKnowledgeRecord
    const records = knowledge.records.map((candidate) =>
      candidate.id === command.recordId ? updatedRecord : candidate
    )

    return withStateMutation(knowledge, records, record.kind !== 'execution-progress', command.recordId)
  }

  const existingRecord = knowledge.records.find((record) => record.id === command.record.id)
  requireExpectedRecordRevision(existingRecord, command.expectedRecordRevision)

  if (existingRecord && existingRecord.kind !== command.record.kind) {
    throw new TypeError('A Workstream record cannot change kind.')
  }

  const protectedExistingRecord =
    existingRecord &&
    ((existingRecord.kind === 'decision' && existingRecord.status !== 'proposed') ||
      (existingRecord.kind === 'assumption' && existingRecord.status !== 'proposed'))
  const createsProtectedStatus =
    (command.record.kind === 'decision' && command.record.status !== 'proposed') ||
    (command.record.kind === 'assumption' && command.record.status !== 'proposed')

  if (context.actor === 'pi' && (protectedExistingRecord || createsProtectedStatus)) {
    throw new TypeError('Pi cannot accept, supersede, or rewrite accepted decisions or assumptions.')
  }
  if (!existingRecord && createsProtectedStatus) {
    throw new TypeError('Decisions and assumptions require an explicit user acceptance transition.')
  }
  if (
    existingRecord?.kind === 'decision' &&
    command.record.kind === 'decision' &&
    command.record.status !== existingRecord.status
  ) {
    throw new TypeError('A decision status requires an explicit user transition.')
  }
  if (
    existingRecord?.kind === 'assumption' &&
    command.record.kind === 'assumption' &&
    command.record.status !== existingRecord.status
  ) {
    throw new TypeError('An assumption status requires an explicit user transition.')
  }

  const updatedRecord = {
    ...command.record,
    revision: (existingRecord?.revision ?? 0) + 1,
    provenance: provenance(context),
    tombstoned: false,
  } as WorkstreamKnowledgeRecord
  const records = existingRecord
    ? knowledge.records.map((record) => (record.id === updatedRecord.id ? updatedRecord : record))
    : [...knowledge.records, updatedRecord]
  const specificationRelevant = updatedRecord.kind !== 'execution-progress'

  return withStateMutation(knowledge, records, specificationRelevant, updatedRecord.id)
}

export function applyPiWorkstreamKnowledgeCommand(
  knowledge: WorkstreamKnowledge,
  command: WorkstreamKnowledgeCommand,
  context: Omit<WorkstreamKnowledgeCommandContext, 'actor'>
): WorkstreamKnowledgeMutationResult {
  return applyWorkstreamKnowledgeCommand(knowledge, command, { ...context, actor: 'pi' })
}
