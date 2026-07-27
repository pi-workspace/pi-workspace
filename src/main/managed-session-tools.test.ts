import assert from 'node:assert/strict'
import test from 'node:test'
import { sessionId } from '@/src/domain/session'
import type { ManagedSessionRuntimePolicy } from '@/src/domain/managed-session'
import { managedSessionMethodology, projectWorkspaceOverview } from './managed-session-tools'

function policy(): ManagedSessionRuntimePolicy {
  return {
    workspaceId: 'workspace-a',
    workstreamId: 'workstream-a',
    sessionId: sessionId('session-a'),
    goal: 'Ship the Workstream goal',
    lifecycle: 'active',
    repositories: [
      {
        id: 'repository-a',
        name: 'Available Repository',
        workingPath: '/workspaces/available',
        workingLocation: 'source-checkout',
        commonDirectoryPath: '/workspaces/available/.git',
        availability: 'available',
        role: 'Application',
        relationships: ['repository-b'],
        validationCommands: ['bun test'],
      },
      {
        id: 'repository-b',
        name: 'Unavailable Repository',
        commonDirectoryPath: '/workspaces/unavailable/.git',
        availability: 'unavailable',
        role: 'Library',
        relationships: [],
        validationCommands: [],
      },
    ],
    piSessionPath: '/sessions/session-a.jsonl',
    resourcePolicyRevision: 1,
  }
}

test('Workspace overview supplies working paths only for selected available Repositories', () => {
  const overview = projectWorkspaceOverview(policy())

  assert.equal('mode' in overview, false)
  assert.equal(overview.repositories[0]?.workingPath, '/workspaces/available')
  assert.equal(overview.repositories[0]?.workingLocation, 'source-checkout')
  assert.equal('workingPath' in overview.repositories[1]!, false)
  assert.deepEqual(overview.repositories[0]?.relationships, ['repository-b'])
})

test('Workstream methodology adds selected Repository metadata and locations to the system prompt', () => {
  const methodology = managedSessionMethodology(policy())

  assert.match(methodology, /Railyard Workstream Session/)
  assert.match(methodology, /Workstream goal: Ship the Workstream goal/)
  assert.match(methodology, /"name": "Available Repository"/)
  assert.match(methodology, /"workingPath": "\/workspaces\/available"/)
  assert.match(methodology, /"role": "Application"/)
  assert.match(methodology, /"relationships": \[/)
  assert.match(methodology, /"validationCommands": \[/)
  assert.match(methodology, /Before modifying a Repository, call prepare_repository with its id/)
  assert.doesNotMatch(methodology, /Brainstorm|Implement mode|Implement Session/)
})
