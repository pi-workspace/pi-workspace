import assert from 'node:assert/strict'
import test from 'node:test'
import type { Workstream } from '@/src/domain/workstream'
import { createEmptyWorkstreamKnowledge, type WorkstreamKnowledge } from '@/src/domain/workstream-knowledge-transitions'
import { projectWorkstreamContext } from './workstream-context-projection'

const workstream: Workstream = {
  id: 'workstream-a',
  workspaceId: 'workspace-a',
  goal: 'Ship the change',
  lifecycle: 'active',
  workingLocation: 'current-checkouts',
  repositoryWorkingLocations: [],
  sessions: [],
}

const provenance = { actor: 'pi' as const, at: 1 }

test('projects plan steps in dependency order', () => {
  const knowledge: WorkstreamKnowledge = {
    ...createEmptyWorkstreamKnowledge(workstream.id, workstream.goal!),
    records: [
      {
        id: 'step-b',
        kind: 'plan-step',
        summary: 'Publish the contract.',
        repositoryIds: ['repository-a'],
        dependencyIds: ['step-a'],
        evidenceIds: [],
        revision: 1,
        provenance,
        tombstoned: false,
      },
      {
        id: 'step-a',
        kind: 'plan-step',
        summary: 'Update the contract.',
        repositoryIds: ['repository-a'],
        dependencyIds: [],
        evidenceIds: [],
        revision: 1,
        provenance,
        tombstoned: false,
      },
    ],
  }

  const projection = projectWorkstreamContext(workstream, {
    status: 'loaded',
    workstreamId: workstream.id,
    knowledge,
  })

  assert.deepEqual(
    projection.planSteps.map((step) => step.id),
    ['step-a', 'step-b']
  )
})

test('projects loading and failure states without claiming empty content', () => {
  const loading = projectWorkstreamContext(workstream, { status: 'loading', workstreamId: workstream.id })

  assert.equal(loading.contentMessage, 'Loading Workstream knowledge…')
  assert.equal(loading.specificationMessage, 'Loading Workstream knowledge…')
  assert.equal(
    projectWorkstreamContext(workstream, {
      status: 'failed',
      workstreamId: workstream.id,
      message: 'State unavailable.',
    }).contentMessage,
    'State unavailable.'
  )
})

test('does not fabricate an implementation order for invalid dependencies', () => {
  const knowledge: WorkstreamKnowledge = {
    ...createEmptyWorkstreamKnowledge(workstream.id, workstream.goal!),
    records: [
      {
        id: 'step-a',
        kind: 'plan-step',
        summary: 'Update the contract.',
        repositoryIds: ['repository-a'],
        dependencyIds: ['missing-step'],
        evidenceIds: [],
        revision: 1,
        provenance,
        tombstoned: false,
      },
    ],
  }

  const projection = projectWorkstreamContext(workstream, {
    status: 'loaded',
    workstreamId: workstream.id,
    knowledge,
  })

  assert.equal(projection.invalidPlanOrder, true)
  assert.deepEqual(projection.planSteps, [])
})
