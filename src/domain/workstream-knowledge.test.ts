import assert from 'node:assert/strict'
import test from 'node:test'
import { deriveSpecificationReadiness, type WorkstreamKnowledgeRecord } from './workstream-knowledge'

const provenance = { actor: 'user' as const, at: 1 }

function record(value: object): WorkstreamKnowledgeRecord {
  return { ...value, provenance, revision: 1, tombstoned: false } as WorkstreamKnowledgeRecord
}

function readyRecords(): readonly WorkstreamKnowledgeRecord[] {
  return [
    record({
      id: 'evidence-a',
      kind: 'evidence',
      source: { kind: 'user-message', messageId: 'message-a' },
    }),
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
      successCondition: 'The focused tests pass.',
    }),
  ]
}

test('reports a complete evidence-backed specification as ready', () => {
  const readiness = deriveSpecificationReadiness({
    goal: 'Update the service',
    repositoryIds: ['repository-a'],
    records: readyRecords(),
  })

  assert.equal(readiness.ready, true)
  assert.deepEqual(readiness.blockers, [])
})

test('does not report an empty Workstream specification as ready', () => {
  const readiness = deriveSpecificationReadiness({ goal: 'Update the service', repositoryIds: [], records: [] })

  assert.ok(readiness.blockers.some((blocker) => blocker.code === 'empty-specification'))
})

test('rejects conflicting current Repository impacts', () => {
  const records = [
    ...readyRecords(),
    record({
      id: 'impact-b',
      kind: 'repository-impact',
      repositoryId: 'repository-a',
      classification: 'unaffected',
      summary: 'No change is needed.',
      evidenceIds: ['evidence-a'],
    }),
  ]
  const readiness = deriveSpecificationReadiness({
    goal: 'Update the service',
    repositoryIds: ['repository-a'],
    records,
  })

  assert.ok(readiness.blockers.some((blocker) => blocker.code === 'conflicting-repository-impact'))
})

test('does not accept stale evidence for a Repository impact', () => {
  const records = readyRecords().map((entry) =>
    entry.kind === 'evidence'
      ? {
          ...entry,
          source: {
            kind: 'repository' as const,
            repositoryId: 'repository-a',
            stale: true,
            origin: 'source-checkout' as const,
            path: 'src/service.ts',
            excerpt: 'Current behavior',
          },
        }
      : entry
  )
  const readiness = deriveSpecificationReadiness({
    goal: 'Update the service',
    repositoryIds: ['repository-a'],
    records,
  })

  assert.equal(readiness.ready, false)
  assert.ok(readiness.blockers.some((blocker) => blocker.code === 'unsupported-repository-impact'))
})

test('does not accept incomplete Repository evidence', () => {
  const records = readyRecords().map((entry) =>
    entry.kind === 'evidence'
      ? ({
          ...entry,
          source: { kind: 'repository', repositoryId: 'repository-a', stale: false },
        } as WorkstreamKnowledgeRecord)
      : entry
  )
  const readiness = deriveSpecificationReadiness({
    goal: 'Update the service',
    repositoryIds: ['repository-a'],
    records,
  })

  assert.ok(readiness.blockers.some((blocker) => blocker.code === 'unsupported-repository-impact'))
})

test('does not accept stale evidence for an accepted decision', () => {
  const records = readyRecords().map((entry) =>
    entry.kind === 'evidence'
      ? {
          ...entry,
          source: {
            kind: 'repository' as const,
            repositoryId: 'repository-a',
            stale: true,
            origin: 'source-checkout' as const,
            path: 'src/service.ts',
            excerpt: 'Current behavior',
          },
        }
      : entry
  )
  const readiness = deriveSpecificationReadiness({
    goal: 'Update the service',
    repositoryIds: ['repository-a'],
    records,
  })

  assert.ok(readiness.blockers.some((blocker) => blocker.code === 'unsupported-decision'))
})

test('does not accept stale evidence for a plan step', () => {
  const records = readyRecords().map((entry) =>
    entry.kind === 'evidence'
      ? {
          ...entry,
          source: {
            kind: 'repository' as const,
            repositoryId: 'repository-a',
            stale: true,
            origin: 'source-checkout' as const,
            path: 'src/service.ts',
            excerpt: 'Current behavior',
          },
        }
      : entry
  )
  const readiness = deriveSpecificationReadiness({
    goal: 'Update the service',
    repositoryIds: ['repository-a'],
    records,
  })

  assert.ok(readiness.blockers.some((blocker) => blocker.code === 'unsupported-plan-step'))
})

test('requires accepted assumptions to resolve blocking questions', () => {
  const records = [
    ...readyRecords(),
    record({
      id: 'question-a',
      kind: 'open-question',
      classification: 'blocking',
      status: 'resolved',
      summary: 'Which rollout should be used?',
      resolutionAssumptionId: 'assumption-a',
    }),
    record({
      id: 'assumption-a',
      kind: 'assumption',
      status: 'proposed',
      summary: 'Use the standard rollout.',
      evidenceIds: [],
    }),
  ]
  const readiness = deriveSpecificationReadiness({
    goal: 'Update the service',
    repositoryIds: ['repository-a'],
    records,
  })

  assert.equal(readiness.ready, false)
  assert.ok(readiness.blockers.some((blocker) => blocker.code === 'unresolved-blocking-question'))
})

test('requires a complete executable plan order', () => {
  const records = readyRecords().map((entry) =>
    entry.kind === 'plan-step' ? { ...entry, dependencyIds: ['missing-step'] } : entry
  )
  const readiness = deriveSpecificationReadiness({
    goal: 'Update the service',
    repositoryIds: ['repository-a'],
    records,
  })

  assert.equal(readiness.ready, false)
  assert.ok(readiness.blockers.some((blocker) => blocker.code === 'invalid-plan-order'))
})
