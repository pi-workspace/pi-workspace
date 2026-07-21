import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyPiWorkstreamKnowledgeCommand,
  applyWorkstreamKnowledgeCommand,
  createEmptyWorkstreamKnowledge,
  type WorkstreamKnowledge,
} from './workstream-knowledge-transitions'
import type { WorkstreamKnowledgeRecord } from './workstream-knowledge'

const knowledge = createEmptyWorkstreamKnowledge('workstream-a', 'Ship the change')
const piContext = { at: 1, sessionId: 'session-a' }
const userContext = { actor: 'user' as const, at: 2 }

function record(value: object): WorkstreamKnowledgeRecord {
  return { ...value, provenance: { actor: 'pi', at: 1 }, revision: 1, tombstoned: false } as WorkstreamKnowledgeRecord
}

function readyState(): WorkstreamKnowledge {
  return {
    ...knowledge,
    knowledgeRevision: 1,
    specificationRevision: 1,
    specificationVersion: 0,
    currentRepositoryIds: ['repository-a'],
    specificationVersions: [],
    records: [
      record({ id: 'evidence-a', kind: 'evidence', source: { kind: 'user-message', messageId: 'message-a' } }),
      record({
        id: 'impact-a',
        kind: 'repository-impact',
        repositoryId: 'repository-a',
        classification: 'changed',
        summary: 'Change the service.',
        evidenceIds: ['evidence-a'],
      }),
      record({
        id: 'decision-a',
        kind: 'decision',
        status: 'accepted',
        summary: 'Use the existing service.',
        evidenceIds: ['evidence-a'],
      }),
      record({
        id: 'step-a',
        kind: 'plan-step',
        summary: 'Update the service.',
        repositoryIds: ['repository-a'],
        dependencyIds: [],
        evidenceIds: ['evidence-a'],
      }),
      record({
        id: 'validation-a',
        kind: 'validation-requirement',
        repositoryId: 'repository-a',
        purpose: 'Verify the service.',
        successCondition: 'Focused tests pass.',
      }),
    ],
  }
}

test('Pi cannot accept a decision through a forged record mutation', () => {
  assert.throws(
    () =>
      applyPiWorkstreamKnowledgeCommand(
        knowledge,
        {
          type: 'put-record',
          expectedKnowledgeRevision: 0,
          expectedRecordRevision: 0,
          record: {
            id: 'decision-a',
            kind: 'decision',
            status: 'accepted',
            summary: 'Use the existing seam.',
            evidenceIds: [],
          },
        },
        piContext
      ),
    /Pi cannot/
  )
})

test('Pi cannot rewrite an accepted decision through a forged record mutation', () => {
  assert.throws(
    () =>
      applyPiWorkstreamKnowledgeCommand(
        readyState(),
        {
          type: 'put-record',
          expectedKnowledgeRevision: 1,
          expectedRecordRevision: 1,
          record: {
            id: 'decision-a',
            kind: 'decision',
            status: 'proposed',
            summary: 'Replace the accepted direction.',
            evidenceIds: ['evidence-a'],
          },
        },
        piContext
      ),
    /rewrite accepted/
  )
})

test('Pi cannot tombstone an accepted decision', () => {
  assert.throws(
    () =>
      applyPiWorkstreamKnowledgeCommand(
        readyState(),
        {
          type: 'tombstone-record',
          expectedKnowledgeRevision: 1,
          expectedRecordRevision: 1,
          recordId: 'decision-a',
        },
        piContext
      ),
    /cannot remove accepted/
  )
})

test('a stable record id cannot change kind', () => {
  assert.throws(
    () =>
      applyWorkstreamKnowledgeCommand(
        readyState(),
        {
          type: 'put-record',
          expectedKnowledgeRevision: 1,
          expectedRecordRevision: 1,
          record: {
            id: 'decision-a',
            kind: 'finding',
            summary: 'Replace the decision with a finding.',
            repositoryIds: [],
            evidenceIds: ['evidence-a'],
          },
        },
        userContext
      ),
    /cannot change kind/
  )
})

test('put-record cannot bypass the explicit decision acceptance transition', () => {
  const proposed = applyPiWorkstreamKnowledgeCommand(
    knowledge,
    {
      type: 'put-record',
      expectedKnowledgeRevision: 0,
      expectedRecordRevision: 0,
      record: {
        id: 'decision-a',
        kind: 'decision',
        status: 'proposed',
        summary: 'Use the existing seam.',
        evidenceIds: [],
      },
    },
    piContext
  )

  assert.throws(
    () =>
      applyWorkstreamKnowledgeCommand(
        proposed.knowledge,
        {
          type: 'put-record',
          expectedKnowledgeRevision: 1,
          expectedRecordRevision: 1,
          record: {
            id: 'decision-a',
            kind: 'decision',
            status: 'accepted',
            summary: 'Use the existing seam.',
            evidenceIds: [],
          },
        },
        userContext
      ),
    /explicit user transition/
  )
})

test('user acceptance changes the decision status and provenance', () => {
  const proposed = applyPiWorkstreamKnowledgeCommand(
    knowledge,
    {
      type: 'put-record',
      expectedKnowledgeRevision: 0,
      expectedRecordRevision: 0,
      record: {
        id: 'decision-a',
        kind: 'decision',
        status: 'proposed',
        summary: 'Use the existing seam.',
        evidenceIds: [],
      },
    },
    piContext
  )
  const accepted = applyWorkstreamKnowledgeCommand(
    proposed.knowledge,
    { type: 'accept-decision', expectedKnowledgeRevision: 1, expectedRecordRevision: 1, recordId: 'decision-a' },
    userContext
  )
  const decision = accepted.knowledge.records[0]

  assert.equal(decision?.kind, 'decision')
  assert.equal(decision?.status, 'accepted')
  assert.equal(decision?.provenance.actor, 'user')
})

test('stale knowledge revisions are rejected before mutation', () => {
  assert.throws(
    () =>
      applyWorkstreamKnowledgeCommand(
        knowledge,
        {
          type: 'tombstone-record',
          expectedKnowledgeRevision: 1,
          expectedRecordRevision: 0,
          recordId: 'missing',
        },
        userContext
      ),
    /stale/
  )
})

test('stale record revisions are rejected independently of the knowledge revision', () => {
  assert.throws(
    () =>
      applyWorkstreamKnowledgeCommand(
        readyState(),
        {
          type: 'put-record',
          expectedKnowledgeRevision: 1,
          expectedRecordRevision: 0,
          record: {
            id: 'step-a',
            kind: 'plan-step',
            summary: 'Overwrite a newer step.',
            repositoryIds: ['repository-a'],
            dependencyIds: [],
            evidenceIds: ['evidence-a'],
          },
        },
        userContext
      ),
    /record is stale/
  )
})

test('approval snapshots exact source records', () => {
  const approved = applyWorkstreamKnowledgeCommand(
    readyState(),
    { type: 'approve-specification', expectedKnowledgeRevision: 1, versionId: 'version-a', approvedAt: 3 },
    userContext
  )
  const approvedPlanStep = approved.knowledge.approvedVersion?.records[3]

  assert.equal(approvedPlanStep?.kind === 'plan-step' && approvedPlanStep.summary, 'Update the service.')
})

test('approval excludes records outside the live specification projection', () => {
  const stateWithNonSpecificationRecords: WorkstreamKnowledge = {
    ...readyState(),
    records: [
      ...readyState().records,
      record({
        id: 'decision-old',
        kind: 'decision',
        status: 'superseded',
        summary: 'Use the old contract.',
        evidenceIds: [],
      }),
      record({
        id: 'assumption-draft',
        kind: 'assumption',
        status: 'proposed',
        summary: 'Use a draft assumption.',
        evidenceIds: [],
      }),
      record({
        id: 'progress-a',
        kind: 'execution-progress',
        repositoryIds: ['repository-a'],
        status: 'in-progress',
        summary: 'Implementation started.',
      }),
      {
        ...record({ id: 'finding-old', kind: 'finding', summary: 'Old.', repositoryIds: [], evidenceIds: [] }),
        tombstoned: true,
      },
    ],
  }
  const approved = applyWorkstreamKnowledgeCommand(
    stateWithNonSpecificationRecords,
    { type: 'approve-specification', expectedKnowledgeRevision: 1, versionId: 'version-a', approvedAt: 3 },
    userContext
  )

  assert.deepEqual(
    approved.knowledge.approvedVersion?.records.map((entry) => entry.id),
    ['evidence-a', 'impact-a', 'decision-a', 'step-a', 'validation-a']
  )
})

test('a specification-relevant mutation returns an approved specification to draft', () => {
  const approved = applyWorkstreamKnowledgeCommand(
    readyState(),
    { type: 'approve-specification', expectedKnowledgeRevision: 1, versionId: 'version-a', approvedAt: 3 },
    userContext
  )
  const changed = applyWorkstreamKnowledgeCommand(
    approved.knowledge,
    {
      type: 'put-record',
      expectedKnowledgeRevision: 2,
      expectedRecordRevision: 1,
      record: {
        id: 'step-a',
        kind: 'plan-step',
        summary: 'Change the service differently.',
        repositoryIds: ['repository-a'],
        dependencyIds: [],
        evidenceIds: ['evidence-a'],
      },
    },
    userContext
  )

  assert.equal(changed.knowledge.approvedVersion, undefined)
})

test('assigns the next immutable version after a draft edit', () => {
  const approved = applyWorkstreamKnowledgeCommand(
    readyState(),
    { type: 'approve-specification', expectedKnowledgeRevision: 1, versionId: 'version-a', approvedAt: 3 },
    userContext
  )
  const changed = applyWorkstreamKnowledgeCommand(
    approved.knowledge,
    {
      type: 'put-record',
      expectedKnowledgeRevision: 2,
      expectedRecordRevision: 1,
      record: {
        id: 'step-a',
        kind: 'plan-step',
        summary: 'Update the service differently.',
        repositoryIds: ['repository-a'],
        dependencyIds: [],
        evidenceIds: ['evidence-a'],
      },
    },
    userContext
  )
  const reapproved = applyWorkstreamKnowledgeCommand(
    changed.knowledge,
    { type: 'approve-specification', expectedKnowledgeRevision: 3, versionId: 'version-b', approvedAt: 5 },
    userContext
  )

  assert.equal(reapproved.knowledge.approvedVersion?.version, 2)
})

test('requires impacts for Repositories in the current Workstream Repository set', () => {
  const currentRepositoryIds = ['repository-a', 'repository-b']
  const stateWithScopedRepository = { ...readyState(), currentRepositoryIds }

  assert.throws(
    () =>
      applyWorkstreamKnowledgeCommand(
        stateWithScopedRepository,
        { type: 'approve-specification', expectedKnowledgeRevision: 1, versionId: 'version-a', approvedAt: 3 },
        userContext
      ),
    /not ready/
  )
})

test('execution progress preserves an approved specification', () => {
  const approved = applyWorkstreamKnowledgeCommand(
    readyState(),
    { type: 'approve-specification', expectedKnowledgeRevision: 1, versionId: 'version-a', approvedAt: 3 },
    userContext
  )
  const progressed = applyWorkstreamKnowledgeCommand(
    approved.knowledge,
    {
      type: 'put-record',
      expectedKnowledgeRevision: 2,
      expectedRecordRevision: 0,
      record: {
        id: 'progress-a',
        kind: 'execution-progress',
        planStepId: 'step-a',
        repositoryIds: ['repository-a'],
        status: 'in-progress',
        summary: 'Started the service change.',
      },
    },
    userContext
  )

  assert.ok(progressed.knowledge.approvedVersion)
  assert.equal(progressed.knowledge.specificationRevision, approved.knowledge.specificationRevision)
})
