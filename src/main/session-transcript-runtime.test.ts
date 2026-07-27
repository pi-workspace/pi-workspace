import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sessionId } from '@/src/domain/session'
import { formatSessionCodeReviewText, type SessionCodeReview } from '@/src/session-code-review'
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

test('persists an accepted action card across a runtime restart', async () => {
  let emit: (event: Parameters<Parameters<PiSessionRuntime['subscribe']>[0]>[0]) => void = () => {}
  const records: import('@/src/main/activity-records').ActivityLayerRecord[] = []
  const runtime: PiSessionRuntime = {
    isStreaming: false,
    async prompt() {},
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
  const id = sessionId('action-card-session')
  const registry = createPiSessionRuntimeRegistry({
    findSession: () => ({ directoryPath: '/tmp', sessionPath: '/tmp/session.jsonl' }),
    createSession: async () => runtime,
  })

  await registry.getTranscript(id)
  emit({
    type: 'action_card_created',
    input: {
      kind: 'start-implement-session',
      title: 'Start implementation',
      description: 'Create an Implement Session for this plan.',
    },
    createdAt: 1,
  })

  const created = (await registry.getTranscript(id)).actionCards?.[0]
  assert.equal(created?.status, 'available')
  assert.ok(created)
  assert.equal(await registry.acceptActionCard(id, created.id), true)
  assert.equal(await registry.acceptActionCard(id, created.id), false)
  assert.equal((await registry.getTranscript(id)).actionCards?.[0]?.status, 'accepted')

  const restartedRegistry = createPiSessionRuntimeRegistry({
    findSession: () => ({ directoryPath: '/tmp', sessionPath: '/tmp/session.jsonl' }),
    createSession: async () => runtime,
  })

  assert.equal((await restartedRegistry.getTranscript(id)).actionCards?.[0]?.status, 'accepted')
})

test('persists a dismissed action card across a runtime restart', async () => {
  let emit: (event: Parameters<Parameters<PiSessionRuntime['subscribe']>[0]>[0]) => void = () => {}
  const records: import('@/src/main/activity-records').ActivityLayerRecord[] = []
  const runtime: PiSessionRuntime = {
    isStreaming: false,
    async prompt() {},
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
  const id = sessionId('dismissed-action-card-session')
  const registry = createPiSessionRuntimeRegistry({
    findSession: () => ({ directoryPath: '/tmp', sessionPath: '/tmp/session.jsonl' }),
    createSession: async () => runtime,
  })

  await registry.getTranscript(id)
  emit({
    type: 'action_card_created',
    input: {
      kind: 'prepare-pull-request',
      title: 'Prepare the pull request',
      description: 'The changes are ready for review.',
    },
    createdAt: 1,
  })

  const created = (await registry.getTranscript(id)).actionCards?.[0]
  assert.ok(created)
  assert.equal(await registry.dismissActionCard(id, created.id), true)
  assert.equal(await registry.dismissActionCard(id, created.id), false)
  assert.equal((await registry.getTranscript(id)).actionCards?.[0]?.status, 'dismissed')

  const restartedRegistry = createPiSessionRuntimeRegistry({
    findSession: () => ({ directoryPath: '/tmp', sessionPath: '/tmp/session.jsonl' }),
    createSession: async () => runtime,
  })

  assert.equal((await restartedRegistry.getTranscript(id)).actionCards?.[0]?.status, 'dismissed')
})

test('rejects a tagged submission when file reference lookup fails', async () => {
  const runtime: PiSessionRuntime = {
    isStreaming: false,
    async prompt() {
      assert.fail('A rejected file reference must not prompt the Agent.')
    },
    subscribe() {
      return () => {}
    },
    async getFileReference() {
      throw new Error('The managed Session policy is stale.')
    },
    dispose() {},
  }
  const registry = createPiSessionRuntimeRegistry({
    findSession: () => ({ directoryPath: '/tmp', sessionPath: '/tmp/session.jsonl' }),
    createSession: async () => runtime,
  })

  assert.deepEqual(
    await registry.submit({ sessionId: sessionId('file-lookup-session'), text: '@src/app.ts', delivery: 'steer' }),
    { status: 'rejected', reason: 'unexpected' }
  )
})

test('keeps file source metadata within the file context budget', async () => {
  const prompts: string[] = []
  const runtime: PiSessionRuntime = {
    isStreaming: false,
    async prompt(text) {
      prompts.push(text)
    },
    subscribe() {
      return () => {}
    },
    async getFileReference() {
      return { path: 'src/app.ts', kind: 'file', availability: 'available' }
    },
    async getFileContext() {
      return '## Referenced file: `src/app.ts`\\n\\n```ts\\nexport {}\\n```'
    },
    dispose() {},
  }
  const registry = createPiSessionRuntimeRegistry({
    findSession: () => ({ directoryPath: '/tmp', sessionPath: '/tmp/session.jsonl' }),
    createSession: async () => runtime,
  })

  assert.deepEqual(
    await registry.submit({
      sessionId: sessionId('file-source-budget-session'),
      text: `@src/app.ts ${'a'.repeat(75_000)}`,
      delivery: 'steer',
    }),
    { status: 'rejected', reason: 'preflight-rejected' }
  )
  assert.deepEqual(prompts, [])
})

test('persists an unfinished code-review comment across a runtime restart', async () => {
  const records: import('@/src/main/activity-records').ActivityLayerRecord[] = []
  const runtime: PiSessionRuntime = {
    isStreaming: false,
    async prompt() {},
    subscribe() {
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
  const id = sessionId('review-draft-session')
  const options = {
    findSession: () => ({ directoryPath: '/tmp', sessionPath: '/tmp/session.jsonl' }),
    createSession: async () => runtime,
    createId: () => 'comment-1',
    now: () => 10,
  }
  const registry = createPiSessionRuntimeRegistry(options)
  const reference = {
    repositoryId: 'repository-1',
    repositoryName: 'Pi Workspace',
    path: 'src/example.ts',
    oldStart: 2,
    oldLines: 1,
    newStart: 2,
    newLines: 2,
    patch: '@@ -2 +2,2 @@\n-old\n+new',
  }

  await registry.saveCodeReviewComment({ sessionId: id, text: 'Preserve this.', reference })

  const restartedRegistry = createPiSessionRuntimeRegistry(options)
  assert.deepEqual((await restartedRegistry.getCodeReviewDraft(id)).comments, [
    { id: 'comment-1', text: 'Preserve this.', reference, createdAt: 10 },
  ])
})

test('does not restore comments already accepted into a queued code review', async () => {
  const comment = {
    id: 'comment-1',
    text: 'Preserve this.',
    createdAt: 10,
    reference: {
      repositoryId: 'repository-1',
      repositoryName: 'Pi Workspace',
      path: 'src/example.ts',
      oldStart: 2,
      oldLines: 1,
      newStart: 2,
      newLines: 2,
      patch: '@@ -2 +2,2 @@\n-old\n+new',
    },
  }
  const codeReview = { kind: 'review' as const, comments: [comment] }
  const runtime: PiSessionRuntime = {
    isStreaming: false,
    async prompt() {},
    subscribe() {
      return () => {}
    },
    loadHistory() {
      return {
        conversations: [],
        activityRecords: [
          { version: 1 as const, type: 'code-review-comment' as const, comment },
          {
            version: 1 as const,
            type: 'queued-follow-up' as const,
            followUp: {
              id: 'follow-up-1',
              text: formatSessionCodeReviewText(codeReview),
              codeReview,
              createdAt: 11,
            },
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

  assert.deepEqual((await registry.getCodeReviewDraft(sessionId('queued-review-session'))).comments, [])
})

test('finishes pending comments as one structured code-review message', async () => {
  const records: import('@/src/main/activity-records').ActivityLayerRecord[] = []
  const prompts: string[] = []
  const runtime: PiSessionRuntime = {
    isStreaming: false,
    async prompt(text, options) {
      prompts.push(text)
      options.preflightResult(true)
    },
    subscribe() {
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
  const id = sessionId('finished-review-session')
  const registry = createPiSessionRuntimeRegistry({
    findSession: () => ({ directoryPath: '/tmp', sessionPath: '/tmp/session.jsonl' }),
    createSession: async () => runtime,
    createId: () => 'comment-1',
    now: () => 10,
  })
  const reference = {
    repositoryId: 'repository-1',
    repositoryName: 'Pi Workspace',
    path: 'src/example.ts',
    oldStart: 2,
    oldLines: 1,
    newStart: 2,
    newLines: 2,
    patch: '@@ -2 +2,2 @@\n-old\n+new',
  }

  await registry.saveCodeReviewComment({ sessionId: id, text: 'Preserve this.', reference })
  assert.deepEqual(await registry.finishCodeReview(id), { status: 'accepted', delivery: 'prompt' })

  const snapshot = await registry.getTranscript(id)
  const message = snapshot.entries.find((entry) => entry.type === 'message')
  assert.equal(message?.type === 'message' ? message.message.codeReview?.kind : undefined, 'review')
  assert.deepEqual((await registry.getCodeReviewDraft(id)).comments, [])
  assert.match(prompts[0] ?? '', /Code review with 1 comment across 1 file/)
})

test('clears an accepted review from memory when its clear record cannot be persisted', async () => {
  const runtime: PiSessionRuntime = {
    isStreaming: false,
    async prompt(_text, options) {
      options.preflightResult(true)
    },
    subscribe() {
      return () => {}
    },
    appendActivityRecord(record) {
      if (record.type === 'code-review-comments-cleared') throw new Error('Disk unavailable')
    },
    dispose() {},
  }
  const id = sessionId('review-clear-failure-session')
  const registry = createPiSessionRuntimeRegistry({
    findSession: () => ({ directoryPath: '/tmp', sessionPath: '/tmp/session.jsonl' }),
    createSession: async () => runtime,
  })

  await registry.saveCodeReviewComment({
    sessionId: id,
    text: 'Preserve this.',
    reference: {
      repositoryId: 'repository-1',
      repositoryName: 'Pi Workspace',
      path: 'src/example.ts',
      oldStart: 2,
      oldLines: 1,
      newStart: 2,
      newLines: 2,
      patch: '@@ -2 +2,2 @@\n-old\n+new',
    },
  })

  assert.deepEqual(await registry.finishCodeReview(id), { status: 'accepted', delivery: 'prompt' })
  assert.deepEqual((await registry.getCodeReviewDraft(id)).comments, [])
})

test('restores structured code-review metadata with its persisted user message', async () => {
  const codeReview = {
    kind: 'follow-up' as const,
    comments: [
      {
        id: 'comment-1',
        text: 'Preserve this.',
        createdAt: 1,
        reference: {
          repositoryId: 'repository-1',
          repositoryName: 'Pi Workspace',
          path: 'src/example.ts',
          oldStart: 2,
          oldLines: 1,
          newStart: 2,
          newLines: 2,
          patch: '@@ -2 +2,2 @@\n-old\n+new',
        },
      },
    ],
  }
  const text =
    'Follow-up about a referenced code change.\n\n' +
    '## Pi Workspace · src/example.ts · +2–3\n\n' +
    '~~~~diff\n@@ -2 +2,2 @@\n-old\n+new\n~~~~\n\nPreserve this.'
  const runtime: PiSessionRuntime = {
    isStreaming: false,
    async prompt() {},
    subscribe() {
      return () => {}
    },
    loadHistory() {
      return {
        conversations: [
          { type: 'conversation' as const, id: 'message-1', role: 'user' as const, text, timestamp: 100 },
        ],
        activityRecords: [
          { version: 1 as const, type: 'code-review-message' as const, review: codeReview, text, acceptedAt: 100 },
        ],
        finalState: 'completed' as const,
      }
    },
    dispose() {},
  }
  const id = sessionId('restored-review-session')
  const registry = createPiSessionRuntimeRegistry({
    findSession: () => ({ directoryPath: '/tmp', sessionPath: '/tmp/session.jsonl' }),
    createSession: async () => runtime,
  })

  const message = (await registry.getTranscript(id)).entries.find((entry) => entry.type === 'message')
  assert.deepEqual(message?.type === 'message' ? message.message.codeReview : undefined, codeReview)
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

test('serializes a user submission behind automatic queued follow-up dispatch', async () => {
  let streaming = true
  let emit: (event: Parameters<Parameters<PiSessionRuntime['subscribe']>[0]>[0]) => void = () => {}
  const prompts: string[] = []
  const runtime: PiSessionRuntime = {
    get isStreaming() {
      return streaming
    },
    async prompt(text, options) {
      prompts.push(text)
      streaming = true
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
  const id = sessionId('serialized-follow-up-dispatch-session')

  await registry.submit({ sessionId: id, text: 'Queued first', delivery: 'follow-up' })
  streaming = false
  emit({ type: 'agent_settled' })

  const userSubmission = registry.submit({ sessionId: id, text: 'User second', delivery: 'steer' })
  await userSubmission
  await new Promise<void>((resolve) => setTimeout(resolve, 0))

  assert.deepEqual(prompts, ['Queued first', 'User second'])
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

test('expands Skills from review comments without interpreting immutable patch text', async () => {
  let promptedText = ''
  const runtime: PiSessionRuntime = {
    isStreaming: false,
    async prompt(text, options) {
      promptedText = text
      options.preflightResult(true)
    },
    getSkills() {
      return [{ name: 'tdd', description: 'Develop test first.' }]
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
  const id = sessionId('review-skill-session')
  const codeReview: SessionCodeReview = {
    kind: 'follow-up',
    comments: [
      {
        id: 'comment-1',
        text: '/skill:tdd Check this documentation change.',
        createdAt: 1,
        reference: {
          repositoryId: 'repository-1',
          repositoryName: 'Pi Workspace',
          path: 'docs.md',
          oldStart: 1,
          oldLines: 1,
          newStart: 1,
          newLines: 1,
          patch: '@@ -1 +1 @@\n-old\n+Run /skill:missing before merging.',
        },
      },
    ],
  }

  const result = await registry.submit({
    sessionId: id,
    text: formatSessionCodeReviewText(codeReview),
    delivery: 'follow-up',
    codeReview,
  })

  assert.deepEqual(result, { status: 'accepted', delivery: 'prompt' })
  assert.match(promptedText, /\+Run \/skill:missing before merging\./)
  assert.match(promptedText, /<tdd> Check this documentation change\./)
})

test('expands files from review comments without interpreting immutable patch text', async () => {
  let promptedText = ''
  const referencedPaths: string[] = []
  const runtime: PiSessionRuntime = {
    isStreaming: false,
    async prompt(text, options) {
      promptedText = text
      options.preflightResult(true)
    },
    async getFileReference(path) {
      referencedPaths.push(path)
      return { path, kind: 'file', availability: 'available' }
    },
    async getFileContext(path) {
      return `<file:${path}>`
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
  const id = sessionId('review-file-session')
  const codeReview: SessionCodeReview = {
    kind: 'follow-up',
    comments: [
      {
        id: 'comment-1',
        text: '@src/app.ts Check this implementation.',
        createdAt: 1,
        reference: {
          repositoryId: 'repository-1',
          repositoryName: 'Pi Workspace',
          path: 'docs.md',
          oldStart: 1,
          oldLines: 1,
          newStart: 1,
          newLines: 1,
          patch: '@@ -1 +1 @@\n-Old documentation.\n @docs.md remains literal.',
        },
      },
    ],
  }

  const result = await registry.submit({
    sessionId: id,
    text: formatSessionCodeReviewText(codeReview),
    delivery: 'follow-up',
    codeReview,
  })

  assert.deepEqual(result, { status: 'accepted', delivery: 'prompt' })
  assert.deepEqual(referencedPaths, ['src/app.ts'])
  assert.match(promptedText, / @docs\.md remains literal\./)
  assert.match(promptedText, /<file:src\/app\.ts> Check this implementation\./)
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

test('queues an Agent Run until Session context compaction completes', async () => {
  let finishCompaction: () => void = () => {}
  const compacted = new Promise<void>((resolve) => {
    finishCompaction = resolve
  })
  let prompted = false
  const runtime: PiSessionRuntime = {
    isStreaming: false,
    async prompt(_text, options) {
      prompted = true
      options.preflightResult(true)
    },
    compact() {
      return compacted
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
  const id = sessionId('compacting-session')

  const compaction = registry.compact(id)
  await Promise.resolve()
  await Promise.resolve()

  assert.equal((await registry.getTranscript(id)).isCompacting, true)
  const submission = registry.submit({ sessionId: id, text: 'start work', delivery: 'steer' })

  assert.equal(prompted, false)

  finishCompaction()
  assert.deepEqual(await compaction, { status: 'compacted' })
  assert.deepEqual(await submission, { status: 'accepted', delivery: 'prompt' })
  assert.equal((await registry.getTranscript(id)).isCompacting, false)
})

test('holds a Session context compaction lease until compaction completes', async () => {
  let finishCompaction: () => void = () => {}
  const compacted = new Promise<void>((resolve) => {
    finishCompaction = resolve
  })
  let leaseHeld = false
  const runtime: PiSessionRuntime = {
    isStreaming: false,
    async prompt() {},
    compact() {
      return compacted
    },
    subscribe() {
      return () => {}
    },
    dispose() {},
  }
  const registry = createPiSessionRuntimeRegistry({
    findSession: () => ({ directoryPath: '/tmp', sessionPath: '/tmp/session.jsonl' }),
    createSession: async () => runtime,
    acquireCompactionLease: () => {
      leaseHeld = true
      return true
    },
    releaseCompactionLease: () => {
      leaseHeld = false
    },
  })
  const id = sessionId('compaction-lease-session')

  const compaction = registry.compact(id)
  await new Promise<void>((resolve) => setTimeout(resolve, 0))

  assert.equal(leaseHeld, true)

  finishCompaction()

  assert.deepEqual(await compaction, { status: 'compacted' })
  assert.equal(leaseHeld, false)
})

test('queues a Model change until Session context compaction completes', async () => {
  let finishCompaction: () => void = () => {}
  const compacted = new Promise<void>((resolve) => {
    finishCompaction = resolve
  })
  let model = { provider: 'provider', id: 'initial' }
  const runtime: PiSessionRuntime = {
    isStreaming: false,
    async prompt() {},
    compact() {
      return compacted
    },
    async getConfiguration() {
      return {
        models: [],
        model,
        effort: 'off',
        supportedEfforts: ['off'],
      }
    },
    async setConfigurationModel(nextModel) {
      model = nextModel
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
  const id = sessionId('compaction-configuration-session')

  const compaction = registry.compact(id)
  await Promise.resolve()
  await Promise.resolve()

  const configuration = registry.setConfigurationModel(id, { provider: 'provider', id: 'selected' })
  await new Promise<void>((resolve) => setTimeout(resolve, 0))

  assert.deepEqual(model, { provider: 'provider', id: 'initial' })

  finishCompaction()

  assert.deepEqual(await compaction, { status: 'compacted' })
  assert.equal((await configuration).status, 'applied')
  assert.deepEqual(model, { provider: 'provider', id: 'selected' })
})

test('does not compact while a submission is acquiring its Session run lease', async () => {
  let authorizeSubmission: () => void = () => {}
  const submissionAuthorized = new Promise<void>((resolve) => {
    authorizeSubmission = resolve
  })
  let prompted = false
  const runtime: PiSessionRuntime = {
    isStreaming: false,
    async prompt(_text, options) {
      prompted = true
      options.preflightResult(true)
    },
    async compact() {},
    subscribe() {
      return () => {}
    },
    dispose() {},
  }
  const registry = createPiSessionRuntimeRegistry({
    findSession: () => ({ directoryPath: '/tmp', sessionPath: '/tmp/session.jsonl' }),
    canSubmit: async () => {
      await submissionAuthorized
      return true
    },
    createSession: async () => runtime,
  })
  const id = sessionId('submission-lease-session')

  const submission = registry.submit({ sessionId: id, text: 'start work', delivery: 'steer' })
  const compaction = registry.compact(id)

  authorizeSubmission()

  assert.deepEqual(await submission, { status: 'accepted', delivery: 'prompt' })
  assert.equal(prompted, true)
  assert.deepEqual(await compaction, {
    status: 'rejected',
    message: 'Wait for the Agent Run to finish before compacting.',
  })
})
