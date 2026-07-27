import assert from 'node:assert/strict'
import test from 'node:test'
import { parseActionCardStatusRequest } from './session-transcript-ipc'

test('accepts a bounded action-card status request', () => {
  assert.deepEqual(parseActionCardStatusRequest({ sessionId: 'session-a', actionCardId: 'card-1' }), {
    sessionId: 'session-a',
    actionCardId: 'card-1',
  })
})

test('rejects an empty or oversized action-card id', () => {
  assert.equal(parseActionCardStatusRequest({ sessionId: 'session-a', actionCardId: '' }), undefined)
  assert.equal(parseActionCardStatusRequest({ sessionId: 'session-a', actionCardId: 'x'.repeat(257) }), undefined)
})
