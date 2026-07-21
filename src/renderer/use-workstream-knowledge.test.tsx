import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { createDemoBridge } from '@/src/demo/demo-bridge'
import { sessionId } from '@/src/domain/session'
import type { Workstream } from '@/src/domain/workstream'
import { createEmptyWorkstreamKnowledge, type WorkstreamKnowledge } from '@/src/domain/workstream-knowledge-transitions'
import { browser } from '@/src/renderer/test-dom'
import { useWorkstreamKnowledge } from './use-workstream-knowledge'

const workstream: Workstream = {
  id: 'workstream-a',
  workspaceId: 'workspace-a',
  goal: 'Ship the change',
  lifecycle: 'active',
  workingLocation: 'current-checkouts',
  repositoryWorkingLocations: [],
  sessions: [],
}

function deferred<Value>() {
  let resolvePromise!: (value: Value) => void
  const promise = new Promise<Value>((resolve) => {
    resolvePromise = resolve
  })

  return { promise, resolve: resolvePromise }
}

afterEach(cleanup)

test('does not query structured knowledge for a Quick Workstream', () => {
  let queried = false
  const bridge = createDemoBridge()
  Object.assign(browser, {
    piWorkspace: {
      ...bridge,
      workstreamKnowledge: {
        ...bridge.workstreamKnowledge,
        async get() {
          queried = true
          throw new Error('Unexpected query.')
        },
      },
    },
  })
  const quickWorkstream: Workstream = {
    ...workstream,
    goal: undefined,
    sessions: [
      {
        id: sessionId('quick-session'),
        workstreamId: workstream.id,
        title: 'Quick Session',
        mode: 'default',
        availability: 'available',
        repositoryAccess: {
          kind: 'direct',
          repositoryId: 'repository-a',
          repositoryName: 'Repository A',
          availability: 'available',
        },
      },
    ],
  }

  const view = renderHook(() => useWorkstreamKnowledge(quickWorkstream))

  assert.equal(view.result.current.status, 'not-applicable')
  assert.equal(queried, false)
})

test('does not replace a newer mutation with an older query response', async () => {
  const initialQuery = deferred<WorkstreamKnowledge>()
  let listener: ((knowledge: WorkstreamKnowledge) => void) | undefined
  const bridge = createDemoBridge()
  Object.assign(browser, {
    piWorkspace: {
      ...bridge,
      workstreamKnowledge: {
        ...bridge.workstreamKnowledge,
        get: () => initialQuery.promise,
        subscribe(nextListener: (knowledge: WorkstreamKnowledge) => void) {
          listener = nextListener
          return () => {
            listener = undefined
          }
        },
      },
    },
  })
  const view = renderHook(() => useWorkstreamKnowledge(workstream))
  const newerState = { ...createEmptyWorkstreamKnowledge(workstream.id, workstream.goal!), knowledgeRevision: 2 }
  const olderState = { ...newerState, knowledgeRevision: 1 }

  await waitFor(() => assert.ok(listener))
  listener?.(newerState)
  initialQuery.resolve(olderState)

  await waitFor(() => {
    assert.equal(view.result.current.status, 'loaded')
    if (view.result.current.status === 'loaded') assert.equal(view.result.current.knowledge.knowledgeRevision, 2)
  })
})

test('surfaces a Workstream-knowledge query failure', async () => {
  const bridge = createDemoBridge()
  Object.assign(browser, {
    piWorkspace: {
      ...bridge,
      workstreamKnowledge: {
        ...bridge.workstreamKnowledge,
        async get() {
          throw new Error('State unavailable.')
        },
      },
    },
  })
  const view = renderHook(() => useWorkstreamKnowledge(workstream))

  await waitFor(() => {
    assert.equal(view.result.current.status, 'failed')
    if (view.result.current.status === 'failed') assert.equal(view.result.current.message, 'State unavailable.')
  })
})
