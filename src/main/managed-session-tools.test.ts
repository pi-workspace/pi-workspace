import assert from 'node:assert/strict'
import test from 'node:test'
import { sessionId } from '@/src/domain/session'
import type { ManagedSessionRuntimePolicy } from '@/src/domain/managed-session'
import {
  managedSessionMethodology,
  parsePiWorkstreamKnowledgeMutation,
  projectWorkspaceOverview,
} from './managed-session-tools'

function policy(mode: 'brainstorm' | 'implement' = 'brainstorm'): ManagedSessionRuntimePolicy {
  return {
    workspaceId: 'workspace-a',
    workstreamId: 'workstream-a',
    sessionId: sessionId('session-a'),
    mode,
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
      },
      {
        id: 'repository-b',
        name: 'Unavailable Repository',
        commonDirectoryPath: '/workspaces/unavailable/.git',
        availability: 'unavailable',
        role: 'Library',
        relationships: [],
      },
    ],
    piSessionPath: '/sessions/session-a.jsonl',
    resourcePolicyRevision: 1,
  }
}

test('Workspace overview supplies working paths only for available Repositories', () => {
  const overview = projectWorkspaceOverview(policy())

  assert.equal(overview.repositories[0]?.workingPath, '/workspaces/available')
  assert.equal(overview.repositories[0]?.workingLocation, 'source-checkout')
  assert.equal('workingPath' in overview.repositories[1]!, false)
  assert.deepEqual(overview.repositories[0]?.relationships, ['repository-b'])
})

test('Brainstorm methodology directs investigation and structured knowledge capture without Repository changes', () => {
  assert.equal(
    managedSessionMethodology('brainstorm'),
    [
      'You are operating a Pi Workspace Brainstorm Session.',
      'Call workspace_overview before Repository work, then use the supplied Repository working paths.',
      'Read workstream_knowledge before investigating. Use update_workstream_knowledge to preserve relevant evidence, findings, questions, proposed decisions, Repository impact, plan steps, and validation requirements for the Workstream.',
      'Investigate the Workspace and produce an implementation-ready specification. Do not modify Repository content.',
    ].join('\n')
  )
})

test('Implement methodology directs implementation from shared knowledge and records progress', () => {
  assert.equal(
    managedSessionMethodology('implement'),
    [
      'You are operating a Pi Workspace Implement Session.',
      'Call workspace_overview before Repository work. Source checkout paths are for inspection only.',
      'Read workstream_knowledge before implementing. Use update_workstream_knowledge to preserve relevant implementation progress and newly discovered Workstream knowledge.',
      'Before modifying a Repository, call prepare_repository with its id. Make and validate all changes in the returned Session worktree path.',
    ].join('\n')
  )
})

test('Pi Workstream knowledge mutation accepts draft record changes', () => {
  assert.deepEqual(
    parsePiWorkstreamKnowledgeMutation({
      operation: 'put-record',
      expectedKnowledgeRevision: 2,
      expectedRecordRevision: 0,
      record: {
        id: 'finding-a',
        kind: 'finding',
        summary: 'The runtime uses normal tools.',
        repositoryIds: ['repository-a'],
        evidenceIds: [],
      },
    }),
    {
      type: 'put-record',
      expectedKnowledgeRevision: 2,
      expectedRecordRevision: 0,
      record: {
        id: 'finding-a',
        kind: 'finding',
        summary: 'The runtime uses normal tools.',
        repositoryIds: ['repository-a'],
        evidenceIds: [],
      },
    }
  )
})

test('Pi Workstream knowledge mutation does not expose user-only transitions', () => {
  assert.equal(
    parsePiWorkstreamKnowledgeMutation({
      operation: 'accept-decision',
      expectedKnowledgeRevision: 1,
      expectedRecordRevision: 1,
      recordId: 'decision-a',
    }),
    undefined
  )
})
