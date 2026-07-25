import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { SessionEntry } from '@earendil-works/pi-coding-agent'
import { canCompactSessionHistory } from './pi-session-compaction'

function messageEntry(id: string, role: 'user' | 'assistant', text: string, timestamp: number): SessionEntry {
  return {
    type: 'message',
    id,
    parentId: null,
    timestamp: new Date(timestamp).toISOString(),
    message:
      role === 'user'
        ? { role, content: [{ type: 'text', text }], timestamp }
        : {
            role,
            content: [{ type: 'text', text }],
            api: 'openai-responses',
            provider: 'test',
            model: 'test',
            usage: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 0,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            },
            stopReason: 'stop',
            timestamp,
          },
  }
}

test('does not offer compaction when the Session has no older context to summarize', () => {
  const entries = [
    messageEntry('user-1', 'user', 'Inspect this Repository.', 1),
    messageEntry('assistant-1', 'assistant', 'The inspection is complete.', 2),
  ]

  assert.equal(canCompactSessionHistory(entries, { keepRecentTokens: 20_000 }), false)
})

test('offers compaction when older Session context can be summarized', () => {
  const entries = [
    messageEntry('user-1', 'user', 'Inspect this Repository.', 1),
    messageEntry('assistant-1', 'assistant', 'The inspection is complete.', 2),
    messageEntry('user-2', 'user', 'Now implement the requested change in detail.', 3),
    messageEntry('assistant-2', 'assistant', 'Implementation is in progress.', 4),
  ]

  assert.equal(canCompactSessionHistory(entries, { keepRecentTokens: 10 }), true)
})
