import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sessionId } from '@/src/domain/session'
import type { PiSessionRuntime } from './pi-session-runtimes'
import { createSessionRuntimeLifecycle } from './pi-session-runtime-lifecycle'

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
