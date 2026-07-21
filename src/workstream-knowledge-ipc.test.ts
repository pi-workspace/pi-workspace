import assert from 'node:assert/strict'
import test from 'node:test'
import { createEmptyWorkstreamKnowledge } from './domain/workstream-knowledge-transitions'
import { createWorkstreamKnowledgeIpcHandlers, parseWorkstreamKnowledgeCommand } from './workstream-knowledge-ipc'

test('rejects malformed evidence sources', () => {
  for (const source of [
    { kind: 'user-message' },
    { kind: 'repository' },
    { kind: 'repository', repositoryId: 'repository-a', stale: 'false' },
  ]) {
    assert.equal(
      parseWorkstreamKnowledgeCommand({
        type: 'put-record',
        expectedKnowledgeRevision: 0,
        expectedRecordRevision: 0,
        record: { id: 'evidence-a', kind: 'evidence', source },
      }),
      undefined
    )
  }
})

test('parses a complete repository evidence source', () => {
  assert.deepEqual(
    parseWorkstreamKnowledgeCommand({
      type: 'put-record',
      expectedKnowledgeRevision: 0,
      expectedRecordRevision: 0,
      record: {
        id: 'evidence-a',
        kind: 'evidence',
        source: {
          kind: 'repository',
          repositoryId: 'repository-a',
          stale: false,
          origin: 'source-checkout',
          path: 'src/service.ts',
          excerpt: 'Current behavior',
        },
      },
    }),
    {
      type: 'put-record',
      expectedKnowledgeRevision: 0,
      expectedRecordRevision: 0,
      record: {
        id: 'evidence-a',
        kind: 'evidence',
        source: {
          kind: 'repository',
          repositoryId: 'repository-a',
          stale: false,
          origin: 'source-checkout',
          path: 'src/service.ts',
          excerpt: 'Current behavior',
        },
      },
    }
  )
})

test('preserves accepted-assumption support references', () => {
  assert.deepEqual(
    parseWorkstreamKnowledgeCommand({
      type: 'put-record',
      expectedKnowledgeRevision: 2,
      expectedRecordRevision: 0,
      record: {
        id: 'step-a',
        kind: 'plan-step',
        summary: 'Apply the accepted direction.',
        repositoryIds: ['repository-a'],
        dependencyIds: [],
        evidenceIds: [],
        assumptionIds: ['assumption-a'],
      },
    }),
    {
      type: 'put-record',
      expectedKnowledgeRevision: 2,
      expectedRecordRevision: 0,
      record: {
        id: 'step-a',
        kind: 'plan-step',
        summary: 'Apply the accepted direction.',
        repositoryIds: ['repository-a'],
        dependencyIds: [],
        evidenceIds: [],
        assumptionIds: ['assumption-a'],
      },
    }
  )
})

test('rejects a missing record revision', () => {
  assert.equal(
    parseWorkstreamKnowledgeCommand({
      type: 'put-record',
      expectedKnowledgeRevision: 0,
      record: {
        id: 'evidence-a',
        kind: 'evidence',
        source: { kind: 'user-message', messageId: 'message-a' },
      },
    }),
    undefined
  )
})

test('rejects malformed commands', () => {
  assert.equal(
    parseWorkstreamKnowledgeCommand({ type: 'approve-specification', expectedKnowledgeRevision: -1 }),
    undefined
  )
})

test('routes valid query and mutation requests to Workstream knowledge authority', async () => {
  const knowledge = createEmptyWorkstreamKnowledge('workstream-a', 'Ship the change')
  const calls: string[] = []
  const handlers = createWorkstreamKnowledgeIpcHandlers({
    async getWorkstreamKnowledge(workstreamId) {
      calls.push(`get:${workstreamId}`)
      return knowledge
    },
    async applyUserWorkstreamKnowledgeCommand(workstreamId) {
      calls.push(`mutate:${workstreamId}`)
      return { knowledge, specificationReadiness: { ready: false, blockers: [] } }
    },
    subscribeWorkstreamKnowledge() {
      return () => {}
    },
  })

  await handlers.get('workstream-a')
  await handlers.mutate('workstream-a', {
    type: 'approve-specification',
    expectedKnowledgeRevision: 0,
    versionId: 'version-a',
    approvedAt: 1,
  })

  assert.deepEqual(calls, ['get:workstream-a', 'mutate:workstream-a'])
})

test('rejects malformed handler requests before calling authority', async () => {
  let called = false
  const handlers = createWorkstreamKnowledgeIpcHandlers({
    async getWorkstreamKnowledge() {
      called = true
      return createEmptyWorkstreamKnowledge('workstream-a', 'Ship the change')
    },
    async applyUserWorkstreamKnowledgeCommand() {
      called = true
      throw new Error('Unexpected authority call.')
    },
    subscribeWorkstreamKnowledge() {
      return () => {}
    },
  })

  await assert.rejects(handlers.get(''), /Workstream is required/)
  await assert.rejects(handlers.mutate('workstream-a', { type: 'unknown' }), /valid Workstream knowledge command/)
  assert.equal(called, false)
})
