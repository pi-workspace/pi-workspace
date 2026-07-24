import assert from 'node:assert/strict'
import test from 'node:test'
import { sessionId } from '@/src/domain/session'
import {
  parseCreateQuickSessionRequest,
  parseCreateSessionRequest,
  parseCreateWorkstreamRequest,
  parsePreviewWorktreeLocationsRequest,
  parseRenameOwnedSessionRequest,
  parseShowWorkingLocationRequest,
  parseWorkstreamLifecycleRequest,
} from './workstreams-ipc'

test('parses Workstream creation with an omitted Session mode', () => {
  assert.deepEqual(parseCreateWorkstreamRequest({ workspaceId: 'workspace-a', goal: 'Ship the change' }), {
    workspaceId: 'workspace-a',
    options: { goal: 'Ship the change' },
  })
})

test('parses Workstream creation with an explicit Session mode', () => {
  assert.deepEqual(
    parseCreateWorkstreamRequest({
      workspaceId: 'workspace-a',
      goal: 'Work separately',
      mode: 'implement',
    }),
    {
      workspaceId: 'workspace-a',
      options: {
        goal: 'Work separately',
        mode: 'implement',
      },
    }
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

test('rejects Default mode through Workstream creation', () => {
  assert.equal(
    parseCreateWorkstreamRequest({ workspaceId: 'workspace-a', goal: 'Ship the change', mode: 'default' }),
    undefined
  )
})

test('rejects Default mode through managed Session creation', () => {
  assert.equal(
    parseCreateSessionRequest({ workstreamId: 'workstream-a', mode: 'default', title: 'Quick Session' }),
    undefined
  )
})

test('rejects an unknown Session mode', () => {
  assert.equal(
    parseCreateSessionRequest({ workstreamId: 'workstream-a', mode: 'execute', title: 'Build it' }),
    undefined
  )
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

test('parses an owned Session rename', () => {
  assert.deepEqual(parseRenameOwnedSessionRequest({ sessionId: 'session-a', title: 'Explore it' }), {
    sessionId: sessionId('session-a'),
    title: 'Explore it',
  })
})
