import assert from 'node:assert/strict'
import test from 'node:test'
import { parseSessionWorkingLocationRequest } from './session-working-locations-ipc'

test('parses a Session working-location request with an optional Repository', () => {
  assert.deepEqual(parseSessionWorkingLocationRequest({ sessionId: 'session-a', repositoryId: 'repository-a' }), {
    sessionId: 'session-a',
    repositoryId: 'repository-a',
  })
  assert.deepEqual(parseSessionWorkingLocationRequest({ sessionId: 'session-a' }), { sessionId: 'session-a' })
})

test('rejects a malformed Session working-location request', () => {
  assert.equal(parseSessionWorkingLocationRequest({ sessionId: '', repositoryId: 'repository-a' }), undefined)
  assert.equal(parseSessionWorkingLocationRequest({ sessionId: 'session-a', repositoryId: '' }), undefined)
})
