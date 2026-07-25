import assert from 'node:assert/strict'
import test from 'node:test'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import type { AssistantMessage } from '@earendil-works/pi-ai'
import {
  createPiSessionMessageStream,
  mapPiSessionMessageHistory,
  projectPiUserMessage,
} from './pi-session-message-mapping'

test('maps every text message on the active branch, including messages before compaction', () => {
  const sessionManager = SessionManager.inMemory()
  sessionManager.appendMessage({ role: 'user', content: 'Before compaction', timestamp: 1 })
  sessionManager.appendMessage(assistantMessage('First Pi response'))
  sessionManager.appendCompaction('Summary omitted from the transcript', 'not-used-in-this-test', 1)
  const branchFromId = sessionManager.appendMessage({ role: 'user', content: 'Choose this branch', timestamp: 2 })
  sessionManager.appendMessage(assistantMessage('Abandoned Pi response'))

  sessionManager.branch(branchFromId)
  sessionManager.appendMessage(assistantMessage('Visible Pi response'))

  assert.deepEqual(
    mapPiSessionMessageHistory(sessionManager.getBranch()).map(({ role, text, state }) => ({ role, text, state })),
    [
      { role: 'user', text: 'Before compaction', state: 'complete' },
      { role: 'assistant', text: 'First Pi response', state: 'complete' },
      { role: 'user', text: 'Choose this branch', state: 'complete' },
      { role: 'assistant', text: 'Visible Pi response', state: 'complete' },
    ]
  )
})

test('projects a persisted Pi Skill invocation without exposing its expanded instructions or path', () => {
  const projected = projectPiUserMessage(
    '<skill name="code-review" location="/private/code-review/SKILL.md">\nExpanded instructions\n</skill>\n\nReview this change.',
    [{ name: 'code-review', description: 'Review code changes.' }]
  )

  assert.deepEqual(projected, {
    text: 'Review this change.',
    skills: [
      {
        offset: 0,
        skill: {
          name: 'code-review',
          description: 'Review code changes.',
          availability: 'available',
        },
      },
    ],
  })
})

test('restores a persisted raw Skill token as an inline reference', () => {
  const projected = projectPiUserMessage('/skill:code-review Review this change.', [
    { name: 'code-review', description: 'Review code changes.' },
  ])

  assert.deepEqual(projected, {
    text: ' Review this change.',
    skills: [
      {
        offset: 0,
        skill: {
          name: 'code-review',
          description: 'Review code changes.',
          availability: 'available',
        },
      },
    ],
  })
})

test('restores a persisted raw file tag as an unavailable inline reference', () => {
  assert.deepEqual(projectPiUserMessage('Review @src/main/index.ts.'), {
    text: 'Review .',
    files: [
      {
        offset: 7,
        file: { path: 'src/main/index.ts', kind: 'file', availability: 'unavailable' },
      },
    ],
  })
})

test('restores a quoted file tag as an unavailable inline reference', () => {
  assert.deepEqual(projectPiUserMessage('Review @@"src/my file.ts".'), {
    text: 'Review .',
    files: [
      {
        offset: 7,
        file: { path: 'src/my file.ts', kind: 'file', availability: 'unavailable' },
      },
    ],
  })
})

test('restores file tags from persisted expanded context', () => {
  const source = 'Review @src/main/index.ts.'
  const persisted = `## Referenced file: \`src/main/index.ts\`\n\n\`\`\`ts\nexport {}\n\`\`\`\n\n<!-- pi-workspace-source:${Buffer.from(source).toString('base64url')} -->`

  assert.deepEqual(projectPiUserMessage(persisted), {
    text: 'Review .',
    files: [
      {
        offset: 7,
        file: { path: 'src/main/index.ts', kind: 'file', availability: 'unavailable' },
      },
    ],
  })
})

test('projects multiple persisted Pi Skill invocations at their authored positions', () => {
  const projected = projectPiUserMessage(
    'Use <skill name="code-review" location="/private/code-review/SKILL.md">\nReview instructions\n</skill> and <skill name="tdd" location="/private/tdd/SKILL.md">\nTDD instructions\n</skill>.',
    [
      { name: 'code-review', description: 'Review code changes.' },
      { name: 'tdd', description: 'Develop test first.' },
    ]
  )

  assert.deepEqual(projected, {
    text: 'Use  and .',
    skills: [
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
    ],
  })
})

test('keeps one Pi message while text streams and completes it with its full source text', () => {
  const stream = createPiSessionMessageStream()
  const message = assistantMessage('')

  const firstDelta = stream.handle({
    type: 'message_update',
    message,
    assistantMessageEvent: { type: 'text_delta', delta: 'First ', partial: message },
  } as never)
  const secondDelta = stream.handle({
    type: 'message_update',
    message,
    assistantMessageEvent: { type: 'text_delta', delta: 'response', partial: message },
  } as never)
  message.content = [{ type: 'text', text: 'First response' }]
  const completed = stream.handle({ type: 'message_end', message } as never)

  assert.deepEqual(firstDelta, [
    {
      type: 'message-upsert',
      message: { id: 'assistant-1', role: 'assistant', text: 'First ', state: 'streaming', revision: 1 },
    },
  ])
  assert.deepEqual(secondDelta, [
    {
      type: 'message-upsert',
      message: { id: 'assistant-1', role: 'assistant', text: 'First response', state: 'streaming', revision: 2 },
    },
  ])
  assert.deepEqual(completed, [
    {
      type: 'message-upsert',
      message: { id: 'assistant-1', role: 'assistant', text: 'First response', state: 'complete', revision: 3 },
    },
  ])
})

test('keeps one Pi message when Pi replaces the message object for each stream event', () => {
  const stream = createPiSessionMessageStream()

  stream.handle({ type: 'message_start', message: assistantMessage('') } as never)
  const firstDelta = stream.handle({
    type: 'message_update',
    message: assistantMessage(''),
    assistantMessageEvent: { type: 'text_delta', delta: 'const ', partial: assistantMessage('') },
  } as never)
  const secondDelta = stream.handle({
    type: 'message_update',
    message: assistantMessage(''),
    assistantMessageEvent: { type: 'text_delta', delta: 'answer = 42', partial: assistantMessage('') },
  } as never)
  const completed = stream.handle({ type: 'message_end', message: assistantMessage('const answer = 42') } as never)

  assert.deepEqual(firstDelta, [
    {
      type: 'message-upsert',
      message: { id: 'assistant-1', role: 'assistant', text: 'const ', state: 'streaming', revision: 1 },
    },
  ])
  assert.deepEqual(secondDelta, [
    {
      type: 'message-upsert',
      message: { id: 'assistant-1', role: 'assistant', text: 'const answer = 42', state: 'streaming', revision: 2 },
    },
  ])
  assert.deepEqual(completed, [
    {
      type: 'message-upsert',
      message: { id: 'assistant-1', role: 'assistant', text: 'const answer = 42', state: 'complete', revision: 3 },
    },
  ])
})

test('omits thinking, tool calls, and tool-only assistant messages', () => {
  const stream = createPiSessionMessageStream()
  const message = assistantMessage('')
  message.content = [
    { type: 'thinking', thinking: 'Hidden reasoning' },
    { type: 'toolCall', id: 'tool-1', name: 'read', arguments: {} },
  ]

  assert.deepEqual(
    stream.handle({
      type: 'message_update',
      message,
      assistantMessageEvent: { type: 'thinking_delta', delta: 'Hidden reasoning', partial: message },
    } as never),
    []
  )
  assert.deepEqual(stream.handle({ type: 'message_end', message } as never), [])
})

test('does not create a Pi message for an empty text delta', () => {
  const stream = createPiSessionMessageStream()
  const message = assistantMessage('')

  assert.deepEqual(
    stream.handle({
      type: 'message_update',
      message,
      assistantMessageEvent: { type: 'text_delta', delta: '', partial: message },
    } as never),
    []
  )
  assert.deepEqual(stream.handle({ type: 'message_end', message } as never), [])
})

test('leaves live person messages to the accepted Composer submission', () => {
  const stream = createPiSessionMessageStream()
  const message = { role: 'user' as const, content: 'Already published by Composer', timestamp: 1 }

  assert.deepEqual(stream.handle({ type: 'message_start', message } as never), [])
})

test('does not mark a successful text response as failed when Pi used a tool first', () => {
  const stream = createPiSessionMessageStream()
  const toolMessage = assistantMessage('')
  toolMessage.content = [{ type: 'toolCall', id: 'tool-1', name: 'read', arguments: {} }]
  toolMessage.stopReason = 'toolUse'
  const response = assistantMessage('Completed after using a tool.')

  assert.deepEqual(stream.handle({ type: 'agent_end', messages: [toolMessage, response], willRetry: false } as never), [
    // Run settlement is published by the Session runtime, not the message mapper.
  ])
})

function assistantMessage(text: string): AssistantMessage {
  return {
    role: 'assistant' as const,
    content: [{ type: 'text' as const, text }],
    api: 'openai-responses',
    provider: 'openai',
    model: 'test',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'stop' as const,
    timestamp: 1,
  }
}
