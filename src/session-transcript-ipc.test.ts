import assert from 'node:assert/strict'
import test from 'node:test'
import { parseActionCardAcceptanceRequest } from './session-transcript-ipc'

test('accepts a bounded action-card acceptance request', () => {
  assert.deepEqual(parseActionCardAcceptanceRequest({ sessionId: 'session-a', actionCardId: 'card-1' }), {
    sessionId: 'session-a',
    actionCardId: 'card-1',
  })
})

test('rejects an empty or oversized action-card id', () => {
  assert.equal(parseActionCardAcceptanceRequest({ sessionId: 'session-a', actionCardId: '' }), undefined)
  assert.equal(parseActionCardAcceptanceRequest({ sessionId: 'session-a', actionCardId: 'x'.repeat(257) }), undefined)
})
