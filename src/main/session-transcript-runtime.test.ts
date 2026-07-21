import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sessionId } from '@/src/domain/session'
import { createPiSessionRuntimeRegistry, type PiSessionRuntime } from './pi-session-runtimes'

test('keeps duplicate messages ordered and updates one streaming identity', async () => {
  let emit: (event: Parameters<Parameters<PiSessionRuntime['subscribe']>[0]>[0]) => void = () => {}
  const runtime: PiSessionRuntime = {
    isStreaming: false,
    async prompt(_text, options) {
      options.preflightResult(true)
    },
    subscribe(listener) {
      emit = listener
      return () => {}
    },
    dispose() {},
  }
  const registry = createPiSessionRuntimeRegistry({
    findSession: () => ({ directoryPath: '/tmp', sessionPath: '/tmp/session.jsonl' }),
    createSession: async () => runtime,
  })
  const id = sessionId('transcript-session')

  await registry.submit({ sessionId: id, text: 'same text', delivery: 'steer' })
  emit({
    type: 'message_upsert',
    message: { id: 'assistant-1', role: 'assistant', text: 'same', state: 'streaming', revision: 0 },
  })
  emit({
    type: 'message_upsert',
    message: { id: 'assistant-1', role: 'assistant', text: 'same text', state: 'complete', revision: 0 },
  })

  const snapshot = await registry.getTranscript(id)

  assert.deepEqual(
    snapshot.entries.map((entry) => (entry.type === 'message' ? [entry.message.id, entry.message.text] : entry.type)),
    [
      ['accepted-0', 'same text'],
      ['assistant-1', 'same text'],
    ]
  )
  const lastEntry = snapshot.entries.at(-1)
  assert.equal(lastEntry?.type, 'message')
  assert.equal(lastEntry?.type === 'message' ? lastEntry.message.state : undefined, 'complete')
})

test('publishes a failed transcript run without a parallel failure stream', async () => {
  let emit: (event: Parameters<Parameters<PiSessionRuntime['subscribe']>[0]>[0]) => void = () => {}
  const runtime: PiSessionRuntime = {
    isStreaming: false,
    async prompt(_text, options) {
      options.preflightResult(true)
    },
    subscribe(listener) {
      emit = listener
      return () => {}
    },
    dispose() {},
  }
  const registry = createPiSessionRuntimeRegistry({
    findSession: () => ({ directoryPath: '/tmp', sessionPath: '/tmp/session.jsonl' }),
    createSession: async () => runtime,
  })
  const id = sessionId('failed-transcript-session')

  await registry.submit({ sessionId: id, text: 'fail this', delivery: 'steer' })
  emit({ type: 'failed', explanation: 'provider failed' })

  const snapshot = await registry.getTranscript(id)

  assert.equal(snapshot.runFailureReason, 'failed')
  assert.equal(snapshot.isWorking, false)
})
