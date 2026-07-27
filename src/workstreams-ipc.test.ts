import assert from 'node:assert/strict'
import test from 'node:test'
import { sessionId } from '@/src/domain/session'
import {
  parseCreateQuickSessionRequest,
  parseCreateSessionRequest,
  parseCreateWorkstreamRequest,
  parseForkSessionRequest,
  parseSessionForkPointsRequest,
  parsePreviewWorktreeLocationsRequest,
  parseRenameOwnedSessionRequest,
  parseShowWorkingLocationRequest,
  parseWorkstreamLifecycleRequest,
} from './workstreams-ipc'

test('parses Workstream creation with selected Repositories', () => {
  assert.deepEqual(
    parseCreateWorkstreamRequest({
      workspaceId: 'workspace-a',
      goal: 'Ship the change',
      repositoryIds: ['repository-a', 'repository-b', 'repository-a'],
    }),
    {
      workspaceId: 'workspace-a',
      options: { goal: 'Ship the change', repositoryIds: ['repository-a', 'repository-b'] },
    }
  )
})

test('rejects Workstream creation without a selected Repository', () => {
  assert.equal(
    parseCreateWorkstreamRequest({ workspaceId: 'workspace-a', goal: 'Ship the change', repositoryIds: [] }),
    undefined
  )
})

test('rejects removed Session modes through Workstream creation', () => {
  assert.equal(
    parseCreateWorkstreamRequest({
      workspaceId: 'workspace-a',
      goal: 'Ship the change',
      repositoryIds: ['repository-a'],
      mode: 'brainstorm',
    }),
    undefined
  )
})

test('parses mode-less Session creation', () => {
  assert.deepEqual(parseCreateSessionRequest({ workstreamId: 'workstream-a', title: 'Build it' }), {
    workstreamId: 'workstream-a',
    options: { title: 'Build it' },
  })
})

test('rejects removed modes through Session creation', () => {
  assert.equal(
    parseCreateSessionRequest({ workstreamId: 'workstream-a', mode: 'implement', title: 'Build it' }),
    undefined
  )
})

test('parses Quick Session creation with a selected working location', () => {
  const workstreamId = '019d47b0-a5f3-7a8c-8def-0123456789ab'

  assert.deepEqual(
    parseCreateQuickSessionRequest({
      workspaceId: 'workspace-a',
      repositoryId: 'repository-a',
      workingLocation: 'worktrees',
      workstreamId,
    }),
    {
      workspaceId: 'workspace-a',
      options: {
        repositoryId: 'repository-a',
        workingLocation: 'worktrees',
        workstreamId,
      },
    }
  )
})

test('parses a worktree preview scoped to one Repository', () => {
  assert.deepEqual(parsePreviewWorktreeLocationsRequest({ workspaceId: 'workspace-a', repositoryId: 'repository-a' }), {
    workspaceId: 'workspace-a',
    repositoryId: 'repository-a',
  })
})

test('rejects a worktree preview without a selected Repository', () => {
  assert.equal(parsePreviewWorktreeLocationsRequest({ workspaceId: 'workspace-a' }), undefined)
})

test('rejects an unknown Workstream lifecycle', () => {
  assert.equal(parseWorkstreamLifecycleRequest({ workstreamId: 'workstream-a', lifecycle: 'deleted' }), undefined)
})

test('parses a request to show one recorded working location', () => {
  assert.deepEqual(parseShowWorkingLocationRequest({ workstreamId: 'workstream-a', repositoryId: 'repository-a' }), {
    workstreamId: 'workstream-a',
    repositoryId: 'repository-a',
  })
})

test('parses a request for Session fork points', () => {
  assert.deepEqual(parseSessionForkPointsRequest({ sessionId: 'session-a' }), {
    sessionId: sessionId('session-a'),
  })
})

test('parses an owned Session fork', () => {
  assert.deepEqual(parseForkSessionRequest({ sessionId: 'session-a', entryId: 'aaaa0001', title: 'Alternative' }), {
    sessionId: sessionId('session-a'),
    options: { entryId: 'aaaa0001', title: 'Alternative' },
  })
})

test('rejects a Session fork without a valid entry', () => {
  assert.equal(parseForkSessionRequest({ sessionId: 'session-a', entryId: '', title: 'Alternative' }), undefined)
})

test('parses an owned Session rename', () => {
  assert.deepEqual(parseRenameOwnedSessionRequest({ sessionId: 'session-a', title: 'Explore it' }), {
    sessionId: sessionId('session-a'),
    title: 'Explore it',
  })
})
