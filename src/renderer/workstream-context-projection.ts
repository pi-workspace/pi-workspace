import type { Workstream } from '@/src/domain/workstream'
import { deriveWorkstreamPlanOrder } from '@/src/domain/workstream-knowledge'
import { deriveWorkstreamKnowledgeReadiness } from '@/src/domain/workstream-knowledge-transitions'
import type { WorkstreamKnowledgeResource } from '@/src/renderer/use-workstream-knowledge'

export function projectWorkstreamContext(workstream: Workstream, resource: WorkstreamKnowledgeResource) {
  const knowledge = resource.status === 'loaded' ? resource.knowledge : undefined
  const records = knowledge?.records.filter((record) => !record.tombstoned) ?? []
  const impacts = records.filter((record) => record.kind === 'repository-impact')
  const findings = records.filter((record) => record.kind === 'finding')
  const assumptions = records.filter((record) => record.kind === 'assumption')
  const decisions = records.filter((record) => record.kind === 'decision')
  const questions = records.filter((record) => record.kind === 'open-question')
  const unorderedPlanSteps = records.filter((record) => record.kind === 'plan-step')
  const orderedPlanSteps = knowledge ? deriveWorkstreamPlanOrder(knowledge.records) : []
  const invalidPlanOrder = knowledge !== undefined && unorderedPlanSteps.length > 0 && orderedPlanSteps === undefined
  const planSteps = orderedPlanSteps ?? []
  const readiness = knowledge ? deriveWorkstreamKnowledgeReadiness(knowledge) : undefined
  const approvedVersion = knowledge?.approvedVersion
  const hasSpecificationContent =
    records.some((record) => record.kind !== 'execution-progress') || (knowledge?.specificationVersions.length ?? 0) > 0
  const hasKnowledgeRecords =
    findings.length > 0 || decisions.length > 0 || assumptions.length > 0 || questions.length > 0
  const hasKnowledge = records.length > 0 || (knowledge?.specificationVersions.length ?? 0) > 0
  const status =
    workstream.lifecycle === 'archived'
      ? 'Archived'
      : resource.status === 'failed'
        ? 'Unavailable'
        : resource.status !== 'loaded'
          ? 'In progress'
          : records.length === 0
            ? undefined
            : approvedVersion
              ? 'Approved'
              : readiness?.ready
                ? 'Ready'
                : 'Draft'
  const contentMessage =
    resource.status === 'failed'
      ? resource.message
      : resource.status === 'loaded'
        ? undefined
        : 'Loading Workstream knowledge…'
  const specificationMessage =
    resource.status === 'failed'
      ? resource.message
      : resource.status !== 'loaded'
        ? 'Loading Workstream knowledge…'
        : records.length === 0
          ? 'No specification yet.'
          : approvedVersion
            ? `Version ${approvedVersion.version} approved.`
            : readiness?.ready
              ? 'Ready for approval.'
              : `${readiness?.blockers.length ?? 0} readiness blockers remain.`

  return {
    assumptions,
    contentMessage,
    decisions,
    findings,
    hasKnowledgeRecords,
    hasSpecificationContent,
    hasKnowledge,
    impacts,
    invalidPlanOrder,
    planSteps,
    questions,
    readiness,
    specificationMessage,
    specificationVersions: knowledge?.specificationVersions ?? [],
    status,
  }
}
