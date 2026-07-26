import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sessionId, type SessionId } from '@/src/domain/session'
import type { PiSessionRuntime } from './pi-session-runtimes'
import { createSessionRuntimeLifecycle } from './pi-session-runtime-lifecycle'

test('passes the Session identity to a newly created runtime', async () => {
  const runtime: PiSessionRuntime = {
    isStreaming: false,
    async prompt() {},
    subscribe() {
      return () => {}
    },
    dispose() {},
  }
  const id = sessionId('session-1')
  let createdSessionId: SessionId | undefined
  const lifecycle = createSessionRuntimeLifecycle({
    findSession() {
      return { directoryPath: '/tmp', sessionPath: '/tmp/session.jsonl' }
    },
    async createSession(_location, sessionId) {
      createdSessionId = sessionId

      return runtime
    },
    attach(_sessionId, _runtimeDirectory, attachedRuntime) {
      return { runtime: attachedRuntime, unsubscribes: [] }
    },
  })

  await lifecycle.get(id)

  assert.equal(createdSessionId, id)
})

test('returns a registered stable runtime without resolving a Session location', async () => {
  const runtime: PiSessionRuntime = {
    isStreaming: false,
    async prompt() {},
    subscribe() {
      return () => {}
    },
    dispose() {},
  }
  let findCalls = 0
  const lifecycle = createSessionRuntimeLifecycle({
    findSession() {
      findCalls += 1
      return undefined
    },
    createSession: async () => runtime,
    attach(_sessionId, _runtimeDirectory, attachedRuntime) {
      return { runtime: attachedRuntime, unsubscribes: [] }
    },
  })
  const id = sessionId('session-1')

  lifecycle.register(id, '/tmp', runtime)

  assert.equal(await lifecycle.get(id), runtime)
  assert.equal(findCalls, 0)
})
