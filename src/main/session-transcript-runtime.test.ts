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

test('invokes multiple available Skills where they were mentioned', async () => {
  let promptedText = ''
  const runtime: PiSessionRuntime = {
    isStreaming: false,
    async prompt(text, options) {
      promptedText = text
      options.preflightResult(true)
    },
    getSkills() {
      return [
        { name: 'code-review', description: 'Review code changes.' },
        { name: 'tdd', description: 'Develop test first.' },
      ]
    },
    getSkillPrompt(name) {
      return `<${name}>`
    },
    subscribe() {
      return () => {}
    },
    dispose() {},
  }
  const registry = createPiSessionRuntimeRegistry({
    findSession: () => ({ directoryPath: '/tmp', sessionPath: '/tmp/session.jsonl' }),
    createSession: async () => runtime,
  })
  const id = sessionId('skill-session')

  const result = await registry.submit({
    sessionId: id,
    text: 'Use /skill:code-review and /skill:tdd',
    delivery: 'steer',
  })
  const snapshot = await registry.getTranscript(id)
  const entry = snapshot.entries[0]

  assert.deepEqual(result, { status: 'accepted', delivery: 'prompt' })
  assert.equal(promptedText, 'Use <code-review> and <tdd>')
  assert.equal(entry?.type, 'message')
  assert.equal(entry?.type === 'message' ? entry.message.text : undefined, 'Use  and ')
  assert.deepEqual(entry?.type === 'message' ? entry.message.skills : undefined, [
    {
      offset: 4,
      skill: {
        name: 'code-review',
        description: 'Review code changes.',
        availability: 'available',
      },
    },
    {
      offset: 9,
      skill: { name: 'tdd', description: 'Develop test first.', availability: 'available' },
    },
  ])
})

test('rejects a selected Skill that is unavailable to the Session runtime', async () => {
  let prompted = false
  const runtime: PiSessionRuntime = {
    isStreaming: false,
    async prompt() {
      prompted = true
    },
    getSkills() {
      return []
    },
    subscribe() {
      return () => {}
    },
    dispose() {},
  }
  const registry = createPiSessionRuntimeRegistry({
    findSession: () => ({ directoryPath: '/tmp', sessionPath: '/tmp/session.jsonl' }),
    createSession: async () => runtime,
  })

  const result = await registry.submit({
    sessionId: sessionId('unavailable-skill-session'),
    text: 'Review with /skill:code-review.',
    delivery: 'steer',
  })

  assert.deepEqual(result, { status: 'rejected', reason: 'skill-unavailable' })
  assert.equal(prompted, false)
})

test('includes the Session context window usage in its transcript snapshot', async () => {
  const runtime: PiSessionRuntime = {
    isStreaming: false,
    async prompt() {},
    getContextUsage() {
      return { tokens: 48_000, contextWindow: 200_000, percent: 24 }
    },
    subscribe() {
      return () => {}
    },
    dispose() {},
  }
  const registry = createPiSessionRuntimeRegistry({
    findSession: () => ({ directoryPath: '/tmp', sessionPath: '/tmp/session.jsonl' }),
    createSession: async () => runtime,
  })

  const snapshot = await registry.getTranscript(sessionId('context-session'))

  assert.deepEqual(snapshot.contextUsage, { tokens: 48_000, contextWindow: 200_000, percent: 24 })
})

test('publishes updated context usage to transcript subscribers', async () => {
  let emit: (event: Parameters<Parameters<PiSessionRuntime['subscribe']>[0]>[0]) => void = () => {}
  const runtime: PiSessionRuntime = {
    isStreaming: false,
    async prompt() {},
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
  const snapshots: unknown[] = []
  registry.subscribeTranscript((mutation) => snapshots.push(mutation.snapshot.contextUsage))
  const id = sessionId('live-context-session')

  await registry.getTranscript(id)
  emit({ type: 'context_usage', usage: { tokens: null, contextWindow: 200_000, percent: null } })

  assert.deepEqual(snapshots, [{ tokens: null, contextWindow: 200_000, percent: null }])
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
