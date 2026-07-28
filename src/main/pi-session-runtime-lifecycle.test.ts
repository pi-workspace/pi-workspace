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

test('creates one runtime when Session resources load concurrently', async () => {
  const runtime: PiSessionRuntime = {
    isStreaming: false,
    async prompt() {},
    subscribe() {
      return () => {}
    },
    dispose() {},
  }
  let releaseLocation: () => void = () => {}
  const locationReady = new Promise<void>((resolve) => {
    releaseLocation = resolve
  })
  let createCalls = 0
  const lifecycle = createSessionRuntimeLifecycle({
    async findSession() {
      await locationReady

      return { directoryPath: '/tmp', sessionPath: '/tmp/session.jsonl', runtimeKey: 'default' }
    },
    async createSession() {
      createCalls += 1

      return runtime
    },
    attach(_sessionId, _runtimeDirectory, attachedRuntime, runtimeKey) {
      return { runtime: attachedRuntime, runtimeKey, unsubscribes: [] }
    },
  })
  const id = sessionId('session-1')

  const transcriptRuntime = lifecycle.get(id)
  const configurationRuntime = lifecycle.get(id)
  releaseLocation()

  assert.equal(await transcriptRuntime, runtime)
  assert.equal(await configurationRuntime, runtime)
  assert.equal(createCalls, 1)
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
