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

test('persists queued follow-ups until the user resumes the queue', async () => {
  let streaming = true
  let emit: (event: Parameters<Parameters<PiSessionRuntime['subscribe']>[0]>[0]) => void = () => {}
  const records: import('@/src/main/activity-records').ActivityLayerRecord[] = []
  const prompts: string[] = []
  const runtime: PiSessionRuntime = {
    get isStreaming() {
      return streaming
    },
    async prompt(text, options) {
      prompts.push(text)
      options.preflightResult(true)
    },
    subscribe(listener) {
      emit = listener
      return () => {}
    },
    loadHistory() {
      return { conversations: [], activityRecords: records, finalState: 'completed' }
    },
    appendActivityRecord(record) {
      records.push(record)
    },
    dispose() {},
  }
  const id = sessionId('queued-follow-up-session')
  const registry = createPiSessionRuntimeRegistry({
    findSession: () => ({ directoryPath: '/tmp', sessionPath: '/tmp/session.jsonl' }),
    createSession: async () => runtime,
  })

  const queued = await registry.submit({ sessionId: id, text: 'Send this next', delivery: 'follow-up' })
  const queuedAfter = await registry.submit({ sessionId: id, text: 'Send this after that', delivery: 'follow-up' })

  assert.deepEqual(queued, { status: 'accepted', delivery: 'follow-up' })
  assert.deepEqual(queuedAfter, { status: 'accepted', delivery: 'follow-up' })
  assert.deepEqual(
    (await registry.getTranscript(id)).queuedFollowUps?.map(({ text }) => text),
    ['Send this next', 'Send this after that']
  )
  assert.deepEqual(prompts, [])
  assert.equal((await registry.getTranscript(id)).queuedFollowUpsPaused, false)

  streaming = false
  const restartedRegistry = createPiSessionRuntimeRegistry({
    findSession: () => ({ directoryPath: '/tmp', sessionPath: '/tmp/session.jsonl' }),
    createSession: async () => runtime,
  })

  assert.deepEqual(
    (await restartedRegistry.getTranscript(id)).queuedFollowUps?.map(({ text }) => text),
    ['Send this next', 'Send this after that']
  )
  assert.equal((await restartedRegistry.getTranscript(id)).queuedFollowUpsPaused, true)
  assert.equal(await restartedRegistry.resumeQueuedFollowUps(id), true)
  assert.deepEqual(prompts, ['Send this next'])

  emit({ type: 'agent_settled' })
  await new Promise<void>((resolve) => setTimeout(() => resolve(), 0))

  assert.deepEqual(prompts, ['Send this next', 'Send this after that'])
  assert.deepEqual((await restartedRegistry.getTranscript(id)).queuedFollowUps, [])
})

test('rejects a queued follow-up when Session history persistence fails', async () => {
  const runtime: PiSessionRuntime = {
    isStreaming: true,
    async prompt() {},
    subscribe() {
      return () => {}
    },
    appendActivityRecord() {
      throw new Error('disk full')
    },
    dispose() {},
  }
  const registry = createPiSessionRuntimeRegistry({
    findSession: () => ({ directoryPath: '/tmp', sessionPath: '/tmp/session.jsonl' }),
    createSession: async () => runtime,
  })
  const id = sessionId('unpersisted-follow-up-session')

  assert.deepEqual(await registry.submit({ sessionId: id, text: 'Do not lose this', delivery: 'follow-up' }), {
    status: 'rejected',
    reason: 'unexpected',
  })
  assert.deepEqual((await registry.getTranscript(id)).queuedFollowUps, [])
})

test('automatically sends a live queued follow-up when the active work settles', async () => {
  let streaming = true
  let emit: (event: Parameters<Parameters<PiSessionRuntime['subscribe']>[0]>[0]) => void = () => {}
  const prompts: string[] = []
  const runtime: PiSessionRuntime = {
    get isStreaming() {
      return streaming
    },
    async prompt(text, options) {
      prompts.push(text)
      options.preflightResult(true)
    },
    subscribe(listener) {
      emit = listener
      return () => {}
    },
    appendActivityRecord() {},
    dispose() {},
  }
  const registry = createPiSessionRuntimeRegistry({
    findSession: () => ({ directoryPath: '/tmp', sessionPath: '/tmp/session.jsonl' }),
    createSession: async () => runtime,
  })
  const id = sessionId('live-follow-up-queue-session')

  await registry.submit({ sessionId: id, text: 'Send this next', delivery: 'follow-up' })
  streaming = false
  emit({ type: 'agent_settled' })
  await new Promise<void>((resolve) => setTimeout(() => resolve(), 0))

  assert.deepEqual(prompts, ['Send this next'])
  assert.deepEqual((await registry.getTranscript(id)).queuedFollowUps, [])
})

test('pauses after dispatch when the delivered queue removal cannot persist', async () => {
  let streaming = true
  let emit: (event: Parameters<Parameters<PiSessionRuntime['subscribe']>[0]>[0]) => void = () => {}
  const prompts: string[] = []
  const runtime: PiSessionRuntime = {
    get isStreaming() {
      return streaming
    },
    async prompt(text, options) {
      prompts.push(text)
      options.preflightResult(true)
    },
    subscribe(listener) {
      emit = listener
      return () => {}
    },
    appendActivityRecord(record) {
      if (record.type === 'queued-follow-up-removed') throw new Error('disk full')
    },
    dispose() {},
  }
  const registry = createPiSessionRuntimeRegistry({
    findSession: () => ({ directoryPath: '/tmp', sessionPath: '/tmp/session.jsonl' }),
    createSession: async () => runtime,
  })
  const id = sessionId('unpersisted-dispatched-follow-up-session')

  await registry.submit({ sessionId: id, text: 'Send this once', delivery: 'follow-up' })
  streaming = false
  emit({ type: 'agent_settled' })
  await new Promise<void>((resolve) => setTimeout(() => resolve(), 0))

  assert.deepEqual(prompts, ['Send this once'])
  assert.equal((await registry.getTranscript(id)).queuedFollowUpsPaused, true)

  emit({ type: 'agent_settled' })
  await new Promise<void>((resolve) => setTimeout(() => resolve(), 0))

  assert.deepEqual(prompts, ['Send this once'])
})

test('publishes a paused queue when automatic dispatch is rejected', async () => {
  let streaming = true
  let availableSkills = [{ name: 'tdd', description: 'Develop test first.' }]
  let emit: (event: Parameters<Parameters<PiSessionRuntime['subscribe']>[0]>[0]) => void = () => {}
  const mutations: import('@/src/session-transcript').SessionTranscriptMutation[] = []
  const runtime: PiSessionRuntime = {
    get isStreaming() {
      return streaming
    },
    async prompt() {},
    subscribe(listener) {
      emit = listener
      return () => {}
    },
    getSkills() {
      return availableSkills
    },
    getSkillPrompt() {
      return 'Develop test first.'
    },
    appendActivityRecord() {},
    dispose() {},
  }
  const registry = createPiSessionRuntimeRegistry({
    findSession: () => ({ directoryPath: '/tmp', sessionPath: '/tmp/session.jsonl' }),
    createSession: async () => runtime,
  })
  const id = sessionId('rejected-follow-up-dispatch-session')
  registry.subscribeTranscript((mutation) => mutations.push(mutation))

  await registry.submit({ sessionId: id, text: '/skill:tdd Write the test.', delivery: 'follow-up' })
  mutations.length = 0
  availableSkills = []
  streaming = false
  emit({ type: 'agent_settled' })
  await new Promise<void>((resolve) => setTimeout(() => resolve(), 0))

  assert.equal(mutations.at(-1)?.snapshot.queuedFollowUpsPaused, true)
})

test('persists Skill references with a queued follow-up', async () => {
  const records: import('@/src/main/activity-records').ActivityLayerRecord[] = []
  const runtime: PiSessionRuntime = {
    isStreaming: true,
    async prompt() {},
    subscribe() {
      return () => {}
    },
    getSkills() {
      return [{ name: 'tdd', description: 'Develop test first.' }]
    },
    getSkillPrompt() {
      return 'Develop test first.'
    },
    appendActivityRecord(record) {
      records.push(record)
    },
    dispose() {},
  }
  const registry = createPiSessionRuntimeRegistry({
    findSession: () => ({ directoryPath: '/tmp', sessionPath: '/tmp/session.jsonl' }),
    createSession: async () => runtime,
    createId: () => 'skilled-follow-up',
  })
  const id = sessionId('skilled-follow-up-queue-session')

  await registry.submit({ sessionId: id, text: '/skill:tdd Write the test.', delivery: 'follow-up' })

  assert.deepEqual((await registry.getTranscript(id)).queuedFollowUps?.[0]?.skills, [
    {
      offset: 0,
      skill: { name: 'tdd', description: 'Develop test first.', availability: 'available' },
    },
  ])
  assert.equal(
    records.some((record) => record.type === 'queued-follow-up'),
    true
  )
})

test('rejects follow-ups after three are queued', async () => {
  const runtime: PiSessionRuntime = {
    isStreaming: true,
    async prompt() {},
    subscribe() {
      return () => {}
    },
    appendActivityRecord() {},
    dispose() {},
  }
  const registry = createPiSessionRuntimeRegistry({
    findSession: () => ({ directoryPath: '/tmp', sessionPath: '/tmp/session.jsonl' }),
    createSession: async () => runtime,
  })
  const id = sessionId('full-follow-up-queue-session')

  for (const text of ['First', 'Second', 'Third']) {
    assert.deepEqual(await registry.submit({ sessionId: id, text, delivery: 'follow-up' }), {
      status: 'accepted',
      delivery: 'follow-up',
    })
  }

  assert.deepEqual(await registry.submit({ sessionId: id, text: 'Fourth', delivery: 'follow-up' }), {
    status: 'rejected',
    reason: 'follow-up-capacity',
  })
  assert.deepEqual(
    (await registry.getTranscript(id)).queuedFollowUps?.map(({ text }) => text),
    ['First', 'Second', 'Third']
  )
})

test('removes a queued follow-up before it resumes', async () => {
  const runtime: PiSessionRuntime = {
    isStreaming: true,
    async prompt() {},
    subscribe() {
      return () => {}
    },
    appendActivityRecord() {},
    dispose() {},
  }
  const registry = createPiSessionRuntimeRegistry({
    findSession: () => ({ directoryPath: '/tmp', sessionPath: '/tmp/session.jsonl' }),
    createSession: async () => runtime,
    createId: () => 'queued-follow-up-id',
  })
  const id = sessionId('removable-follow-up-session')

  await registry.submit({ sessionId: id, text: 'Remove this', delivery: 'follow-up' })

  assert.equal(await registry.removeQueuedFollowUp(id, 'queued-follow-up-id'), true)
  assert.deepEqual((await registry.getTranscript(id)).queuedFollowUps, [])
})

test('keeps a queued follow-up when removal persistence fails', async () => {
  const runtime: PiSessionRuntime = {
    isStreaming: true,
    async prompt() {},
    subscribe() {
      return () => {}
    },
    appendActivityRecord(record) {
      if (record.type === 'queued-follow-up-removed') throw new Error('disk full')
    },
    dispose() {},
  }
  const registry = createPiSessionRuntimeRegistry({
    findSession: () => ({ directoryPath: '/tmp', sessionPath: '/tmp/session.jsonl' }),
    createSession: async () => runtime,
    createId: () => 'queued-follow-up-id',
  })
  const id = sessionId('unremovable-follow-up-session')

  await registry.submit({ sessionId: id, text: 'Keep this', delivery: 'follow-up' })

  assert.equal(await registry.removeQueuedFollowUp(id, 'queued-follow-up-id'), false)
  assert.deepEqual(
    (await registry.getTranscript(id)).queuedFollowUps?.map(({ text }) => text),
    ['Keep this']
  )
})

test('records a message sent to a working Session as steering', async () => {
  const runtime: PiSessionRuntime = {
    isStreaming: true,
    async prompt(_text, options) {
      options.preflightResult(true)
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
  const id = sessionId('steering-session')

  await registry.submit({ sessionId: id, text: 'Prioritize the transcript', delivery: 'steer' })

  const message = (await registry.getTranscript(id)).entries[0]
  assert.equal(message?.type, 'message')
  assert.equal(message?.type === 'message' ? message.message.delivery : undefined, 'steer')
})

test('preserves steering delivery when the Session transcript is reopened', async () => {
  let streaming = true
  const records: import('@/src/main/activity-records').ActivityLayerRecord[] = []
  const conversations: import('@/src/session-timeline').ConversationEntry[] = []
  const runtime: PiSessionRuntime = {
    get isStreaming() {
      return streaming
    },
    async prompt(text, options) {
      conversations.push({ type: 'conversation', id: 'pi-user-message', role: 'user', text, timestamp: 1_000 })
      options.preflightResult(true)
    },
    subscribe() {
      return () => {}
    },
    loadHistory() {
      return { conversations, activityRecords: records, finalState: 'completed' }
    },
    appendActivityRecord(record) {
      records.push(record)
    },
    dispose() {},
  }
  const id = sessionId('persisted-steering-session')
  const registry = createPiSessionRuntimeRegistry({
    findSession: () => ({ directoryPath: '/tmp', sessionPath: '/tmp/session.jsonl' }),
    createSession: async () => runtime,
    now: () => 1_000,
  })

  await registry.submit({ sessionId: id, text: 'Prioritize transcript delivery.', delivery: 'steer' })

  streaming = false
  const restartedRegistry = createPiSessionRuntimeRegistry({
    findSession: () => ({ directoryPath: '/tmp', sessionPath: '/tmp/session.jsonl' }),
    createSession: async () => runtime,
    now: () => 1_000,
  })
  const message = (await restartedRegistry.getTranscript(id)).entries[0]

  assert.equal(message?.type, 'message')
  assert.equal(message?.type === 'message' ? message.message.delivery : undefined, 'steer')
})

test('restores steering delivery to the nearest duplicate message', async () => {
  const runtime: PiSessionRuntime = {
    isStreaming: false,
    async prompt() {},
    subscribe() {
      return () => {}
    },
    loadHistory() {
      return {
        conversations: [
          {
            type: 'conversation' as const,
            id: 'ordinary-message',
            role: 'user' as const,
            text: 'Use the transcript.',
            timestamp: 1_000,
          },
          {
            type: 'conversation' as const,
            id: 'steering-message',
            role: 'user' as const,
            text: 'Use the transcript.',
            timestamp: 2_000,
          },
        ],
        activityRecords: [
          {
            version: 1 as const,
            type: 'steering-message' as const,
            text: 'Use the transcript.',
            acceptedAt: 2_000,
          },
        ],
        finalState: 'completed' as const,
      }
    },
    dispose() {},
  }
  const registry = createPiSessionRuntimeRegistry({
    findSession: () => ({ directoryPath: '/tmp', sessionPath: '/tmp/session.jsonl' }),
    createSession: async () => runtime,
  })

  const messages = (await registry.getTranscript(sessionId('duplicate-steering-session'))).entries.flatMap((entry) =>
    entry.type === 'message' ? [entry.message] : []
  )

  assert.equal(messages[0]?.delivery, undefined)
  assert.equal(messages[1]?.delivery, 'steer')
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

test('keeps published context usage when the runtime cannot report it', async () => {
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
  const id = sessionId('retained-context-session')

  await registry.getTranscript(id)
  emit({ type: 'context_usage', usage: { tokens: 48_000, contextWindow: 200_000, percent: 24 } })
  const snapshot = await registry.getTranscript(id)

  assert.deepEqual(snapshot.contextUsage, { tokens: 48_000, contextWindow: 200_000, percent: 24 })
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
