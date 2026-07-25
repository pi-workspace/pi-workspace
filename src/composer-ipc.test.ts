import assert from 'node:assert/strict'
import test from 'node:test'
import { sessionId } from '@/src/domain/session'
import {
  maximumSessionMessageLength,
  parseQueuedFollowUpRemovalRequest,
  parseSessionMessageSubmission,
  parseSessionRunStopRequest,
} from './composer-ipc'

test('accepts a narrow serializable Agent Run stop request', () => {
  assert.deepEqual(parseSessionRunStopRequest({ sessionId: 'session-a' }), { sessionId: sessionId('session-a') })
})

test('rejects an invalid Agent Run stop request', () => {
  assert.equal(parseSessionRunStopRequest({ sessionId: '' }), undefined)
})

test('accepts a narrow queued follow-up removal request', () => {
  assert.deepEqual(parseQueuedFollowUpRemovalRequest({ sessionId: 'session-a', followUpId: 'follow-up-1' }), {
    sessionId: sessionId('session-a'),
    followUpId: 'follow-up-1',
  })
})

test('rejects an invalid queued follow-up removal request', () => {
  assert.equal(parseQueuedFollowUpRemovalRequest({ sessionId: 'session-a', followUpId: '' }), undefined)
})

test('accepts a narrow serializable Session message submission', () => {
  assert.deepEqual(
    parseSessionMessageSubmission({ sessionId: 'session-a', text: '  Preserve me  ', delivery: 'follow-up' }),
    { sessionId: sessionId('session-a'), text: '  Preserve me  ', delivery: 'follow-up' }
  )
})

test('accepts a Skill-only Session message submission', () => {
  assert.deepEqual(
    parseSessionMessageSubmission({ sessionId: 'session-a', text: '/skill:code-review', delivery: 'steer' }),
    { sessionId: sessionId('session-a'), text: '/skill:code-review', delivery: 'steer' }
  )
})

test('rejects whitespace-only Session message submissions without a Skill at the IPC boundary', () => {
  assert.equal(parseSessionMessageSubmission({ sessionId: 'session-a', text: ' \n ', delivery: 'steer' }), undefined)
})

test('rejects unsupported delivery behavior at the IPC boundary', () => {
  assert.equal(
    parseSessionMessageSubmission({ sessionId: 'session-a', text: 'Hello', delivery: 'immediate' }),
    undefined
  )
})

test('rejects an invalid Session id at the IPC boundary', () => {
  assert.equal(parseSessionMessageSubmission({ sessionId: '', text: 'Hello', delivery: 'steer' }), undefined)
})

test('rejects message text beyond the IPC limit', () => {
  assert.equal(
    parseSessionMessageSubmission({
      sessionId: 'session-a',
      text: 'a'.repeat(maximumSessionMessageLength + 1),
      delivery: 'follow-up',
    }),
    undefined
  )
})
