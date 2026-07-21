import assert from 'node:assert/strict'
import test from 'node:test'
import { isSessionId, maximumSessionIdLength } from './session'

test('recognizes a non-empty string as a Session id', () => {
  assert.equal(isSessionId('session-a'), true)
})

test('rejects an empty Session id', () => {
  assert.equal(isSessionId(''), false)
})

test('rejects a Session id beyond the IPC limit', () => {
  assert.equal(isSessionId('s'.repeat(maximumSessionIdLength + 1)), false)
})

test('rejects whitespace and control characters in a Session id', () => {
  assert.equal(isSessionId('session a'), false)
  assert.equal(isSessionId('session-a\n'), false)
})
