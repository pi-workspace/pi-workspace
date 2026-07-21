export type WorkstreamKnowledgeActor = 'pi' | 'user'

export type WorkstreamKnowledgeProvenance = Readonly<{
  actor: WorkstreamKnowledgeActor
  at: number
  sessionId?: string
}>

type WorkstreamKnowledgeRecordProperties = Readonly<{
  id: string
  revision: number
  provenance: WorkstreamKnowledgeProvenance
  tombstoned: boolean
}>

type EvidenceSupport = Readonly<{
  evidenceIds: readonly string[]
  assumptionIds?: readonly string[]
}>

export type WorkstreamEvidence = Readonly<
  WorkstreamKnowledgeRecordProperties & {
    kind: 'evidence'
    source:
      | Readonly<
          {
            kind: 'repository'
            repositoryId: string
            stale: boolean
            origin: 'source-checkout' | 'workstream-worktree'
            revision?: string
            path: string
            symbol?: string
            lineRange?: Readonly<{ start: number; end?: number }>
          } & (
            Readonly<{ excerpt: string; toolResultId?: string }> | Readonly<{ excerpt?: string; toolResultId: string }>
          )
        >
      | Readonly<{ kind: 'user-message'; messageId: string }>
  }
>

export type WorkstreamFinding = Readonly<
  WorkstreamKnowledgeRecordProperties &
    EvidenceSupport & {
      kind: 'finding'
      summary: string
      repositoryIds: readonly string[]
    }
>

export type WorkstreamDecision = Readonly<
  WorkstreamKnowledgeRecordProperties &
    EvidenceSupport & {
      kind: 'decision'
      status: 'proposed' | 'accepted' | 'superseded'
      summary: string
    }
>

export type WorkstreamAssumption = Readonly<
  WorkstreamKnowledgeRecordProperties &
    EvidenceSupport & {
      kind: 'assumption'
      status: 'proposed' | 'accepted'
      summary: string
    }
>

export type WorkstreamOpenQuestion = Readonly<
  WorkstreamKnowledgeRecordProperties & {
    kind: 'open-question'
    classification: 'blocking' | 'non-blocking'
    status: 'open' | 'resolved'
    summary: string
    resolutionAssumptionId?: string
  }
>

export type WorkstreamRepositoryImpact = Readonly<
  WorkstreamKnowledgeRecordProperties &
    EvidenceSupport & {
      kind: 'repository-impact'
      repositoryId: string
      classification: 'changed' | 'unaffected'
      summary: string
    }
>

export type WorkstreamPlanStep = Readonly<
  WorkstreamKnowledgeRecordProperties &
    EvidenceSupport & {
      kind: 'plan-step'
      summary: string
      repositoryIds: readonly string[]
      dependencyIds: readonly string[]
    }
>

export type WorkstreamValidationRequirement = Readonly<
  WorkstreamKnowledgeRecordProperties & {
    kind: 'validation-requirement'
    repositoryId: string
    purpose: string
    successCondition: string
  }
>

export type WorkstreamExecutionProgress = Readonly<
  WorkstreamKnowledgeRecordProperties & {
    kind: 'execution-progress'
    planStepId?: string
    repositoryIds: readonly string[]
    status: 'pending' | 'in-progress' | 'blocked' | 'complete'
    summary: string
  }
>

export type WorkstreamKnowledgeRecord =
  | WorkstreamEvidence
  | WorkstreamFinding
  | WorkstreamDecision
  | WorkstreamAssumption
  | WorkstreamOpenQuestion
  | WorkstreamRepositoryImpact
  | WorkstreamPlanStep
  | WorkstreamValidationRequirement
  | WorkstreamExecutionProgress

export type WorkstreamKnowledgeRecordDraft = {
  [K in WorkstreamKnowledgeRecord['kind']]: Omit<
    Extract<WorkstreamKnowledgeRecord, { kind: K }>,
    'revision' | 'provenance' | 'tombstoned'
  >
}[WorkstreamKnowledgeRecord['kind']]

export type SpecificationReadinessBlocker = Readonly<{
  code:
    | 'missing-goal'
    | 'empty-specification'
    | 'unresolved-blocking-question'
    | 'missing-repository-impact'
    | 'conflicting-repository-impact'
    | 'unsupported-finding'
    | 'unsupported-decision'
    | 'unsupported-repository-impact'
    | 'unsupported-plan-step'
    | 'unaccepted-decision'
    | 'missing-plan-coverage'
    | 'invalid-plan-order'
    | 'missing-validation-requirement'
  recordId?: string
  repositoryId?: string
}>

export type SpecificationReadiness = Readonly<{
  ready: boolean
  blockers: readonly SpecificationReadinessBlocker[]
}>

export type SpecificationReadinessInput = Readonly<{
  goal?: string
  repositoryIds: readonly string[]
  records: readonly WorkstreamKnowledgeRecord[]
}>

function currentRecords(records: readonly WorkstreamKnowledgeRecord[]): readonly WorkstreamKnowledgeRecord[] {
  return records.filter((record) => !record.tombstoned)
}

export function deriveSpecificationSourceRecords(
  records: readonly WorkstreamKnowledgeRecord[]
): readonly WorkstreamKnowledgeRecord[] {
  return currentRecords(records).filter((record) => {
    if (record.kind === 'execution-progress') return false
    if (record.kind === 'decision') return record.status === 'accepted'
    if (record.kind === 'assumption') return record.status === 'accepted'
    if (record.kind === 'open-question') {
      return record.classification === 'non-blocking' && record.status === 'open'
    }

    return true
  })
}

function recordMap(records: readonly WorkstreamKnowledgeRecord[]): ReadonlyMap<string, WorkstreamKnowledgeRecord> {
  return new Map(records.map((record) => [record.id, record]))
}

function hasCurrentEvidence(record: WorkstreamKnowledgeRecord | undefined): record is WorkstreamEvidence {
  if (record?.kind !== 'evidence') return false
  if (record.source.kind === 'user-message') return Boolean(record.source.messageId)

  return (
    !record.source.stale &&
    Boolean(record.source.repositoryId) &&
    (record.source.origin === 'source-checkout' || record.source.origin === 'workstream-worktree') &&
    Boolean(record.source.path) &&
    Boolean(record.source.excerpt || record.source.toolResultId)
  )
}

function hasAcceptedAssumption(record: WorkstreamKnowledgeRecord | undefined): record is WorkstreamAssumption {
  return record?.kind === 'assumption' && record.status === 'accepted'
}

function hasSupport(record: EvidenceSupport, recordsById: ReadonlyMap<string, WorkstreamKnowledgeRecord>): boolean {
  return (
    record.evidenceIds.some((id) => hasCurrentEvidence(recordsById.get(id))) ||
    record.assumptionIds?.some((id) => hasAcceptedAssumption(recordsById.get(id))) === true
  )
}

export function deriveWorkstreamPlanOrder(
  records: readonly WorkstreamKnowledgeRecord[]
): readonly WorkstreamPlanStep[] | undefined {
  const planSteps = currentRecords(records).filter(
    (record): record is WorkstreamPlanStep => record.kind === 'plan-step'
  )
  const planStepsById = new Map(planSteps.map((step) => [step.id, step]))
  if (planSteps.some((step) => step.dependencyIds.some((dependencyId) => !planStepsById.has(dependencyId)))) {
    return undefined
  }

  const visiting = new Set<string>()
  const visited = new Set<string>()
  const ordered: WorkstreamPlanStep[] = []
  const visit = (step: WorkstreamPlanStep): boolean => {
    if (visited.has(step.id)) return true
    if (visiting.has(step.id)) return false

    visiting.add(step.id)
    if (!step.dependencyIds.every((dependencyId) => visit(planStepsById.get(dependencyId)!))) return false

    visiting.delete(step.id)
    visited.add(step.id)
    ordered.push(step)
    return true
  }

  return planSteps.every(visit) ? ordered : undefined
}

export function deriveSpecificationReadiness({
  goal,
  repositoryIds,
  records,
}: SpecificationReadinessInput): SpecificationReadiness {
  const blockers: SpecificationReadinessBlocker[] = []
  const current = currentRecords(records)
  const recordsById = recordMap(current)
  const findings = current.filter((record): record is WorkstreamFinding => record.kind === 'finding')
  const decisions = current.filter((record): record is WorkstreamDecision => record.kind === 'decision')
  const questions = current.filter((record): record is WorkstreamOpenQuestion => record.kind === 'open-question')
  const impacts = current.filter((record): record is WorkstreamRepositoryImpact => record.kind === 'repository-impact')
  const planSteps = current.filter((record): record is WorkstreamPlanStep => record.kind === 'plan-step')
  const requirements = current.filter(
    (record): record is WorkstreamValidationRequirement => record.kind === 'validation-requirement'
  )

  if (!goal?.trim()) blockers.push({ code: 'missing-goal' })
  if (impacts.length === 0) blockers.push({ code: 'empty-specification' })

  for (const question of questions) {
    const resolvedByAcceptedAssumption =
      question.status === 'resolved' &&
      question.resolutionAssumptionId !== undefined &&
      hasAcceptedAssumption(recordsById.get(question.resolutionAssumptionId))
    if (question.classification === 'blocking' && !resolvedByAcceptedAssumption && question.status !== 'resolved') {
      blockers.push({ code: 'unresolved-blocking-question', recordId: question.id })
    }
    if (question.classification === 'blocking' && question.status === 'resolved' && !resolvedByAcceptedAssumption) {
      blockers.push({ code: 'unresolved-blocking-question', recordId: question.id })
    }
  }

  for (const repositoryId of new Set(repositoryIds)) {
    const repositoryImpacts = impacts.filter((impact) => impact.repositoryId === repositoryId)
    if (repositoryImpacts.length === 0) {
      blockers.push({ code: 'missing-repository-impact', repositoryId })
    }
    if (repositoryImpacts.length > 1) {
      blockers.push({ code: 'conflicting-repository-impact', repositoryId })
    }
  }

  for (const finding of findings) {
    if (!hasSupport(finding, recordsById)) blockers.push({ code: 'unsupported-finding', recordId: finding.id })
  }

  for (const impact of impacts) {
    if (!hasSupport(impact, recordsById)) {
      blockers.push({ code: 'unsupported-repository-impact', recordId: impact.id, repositoryId: impact.repositoryId })
    }
  }

  for (const decision of decisions) {
    if (decision.status === 'proposed') blockers.push({ code: 'unaccepted-decision', recordId: decision.id })
    if (decision.status !== 'superseded' && !hasSupport(decision, recordsById)) {
      blockers.push({ code: 'unsupported-decision', recordId: decision.id })
    }
  }

  for (const planStep of planSteps) {
    if (!hasSupport(planStep, recordsById)) {
      blockers.push({ code: 'unsupported-plan-step', recordId: planStep.id })
    }
  }

  const changedRepositoryIds = new Set(
    impacts.filter((impact) => impact.classification === 'changed').map((impact) => impact.repositoryId)
  )
  for (const repositoryId of changedRepositoryIds) {
    if (!planSteps.some((step) => step.repositoryIds.includes(repositoryId))) {
      blockers.push({ code: 'missing-plan-coverage', repositoryId })
    }
    if (!requirements.some((requirement) => requirement.repositoryId === repositoryId)) {
      blockers.push({ code: 'missing-validation-requirement', repositoryId })
    }
  }

  if (!deriveWorkstreamPlanOrder(planSteps)) blockers.push({ code: 'invalid-plan-order' })

  return { ready: blockers.length === 0, blockers }
}
