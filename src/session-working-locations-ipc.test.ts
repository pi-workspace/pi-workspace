import assert from 'node:assert/strict'
import test from 'node:test'
import { parseSessionBranchRequest, parseSessionWorkingLocationRequest } from './session-working-locations-ipc'

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

test('parses branch discovery and selection requests', () => {
  assert.deepEqual(parseSessionBranchRequest({ sessionId: 'session-a', repositoryId: 'repository-a', refresh: true }), {
    sessionId: 'session-a',
    repositoryId: 'repository-a',
    refresh: true,
  })
  assert.deepEqual(
    parseSessionBranchRequest({
      sessionId: 'session-a',
      repositoryId: 'repository-a',
      branchRef: 'refs/remotes/origin/feature/test',
    }),
    {
      sessionId: 'session-a',
      repositoryId: 'repository-a',
      branchRef: 'refs/remotes/origin/feature/test',
    }
  )
})

test('rejects malformed branch discovery and selection requests', () => {
  assert.equal(
    parseSessionBranchRequest({ sessionId: 'session-a', repositoryId: 'repository-a', refresh: 'yes' }),
    undefined
  )
  assert.equal(
    parseSessionBranchRequest({ sessionId: 'session-a', repositoryId: 'repository-a', branchRef: '' }),
    undefined
  )
  assert.equal(
    parseSessionBranchRequest({
      sessionId: 'session-a',
      repositoryId: 'repository-a',
      refresh: true,
      branchRef: 'refs/heads/main',
    }),
    undefined
  )
})
