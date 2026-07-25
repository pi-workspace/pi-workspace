import assert from 'node:assert/strict'
import test from 'node:test'
import { sessionId } from '@/src/domain/session'
import type { ManagedSessionRuntimePolicy } from '@/src/domain/managed-session'
import {
  maximumSessionMessageLength,
  parseQueuedFollowUpRemovalRequest,
  parseSessionMessageSubmission,
  parseSessionRunStopRequest,
} from './composer-ipc'
import { managedSessionFileRoots } from './main/managed-session-file-roots'

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

test('uses managed Repository IDs as unambiguous file prefixes', () => {
  const policy: ManagedSessionRuntimePolicy = {
    workspaceId: 'workspace-a',
    workstreamId: 'workstream-a',
    sessionId: sessionId('session-a'),
    mode: 'implement',
    lifecycle: 'active',
    piSessionPath: '/tmp/session.jsonl',
    resourcePolicyRevision: 1,
    repositories: [
      {
        id: 'repository-one',
        name: 'app',
        commonDirectoryPath: '/tmp/one/.git',
        role: '',
        relationships: [],
        availability: 'available',
        workingPath: '/tmp/one/app',
        workingLocation: 'session-worktree',
      },
      {
        id: 'repository-two',
        name: 'app',
        commonDirectoryPath: '/tmp/two/.git',
        role: '',
        relationships: [],
        availability: 'available',
        workingPath: '/tmp/two/app',
        workingLocation: 'session-worktree',
      },
    ],
  }

  assert.deepEqual(managedSessionFileRoots(policy), [
    { path: '/tmp/one/app', prefix: 'repository-one' },
    { path: '/tmp/two/app', prefix: 'repository-two' },
  ])
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
