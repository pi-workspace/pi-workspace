import assert from 'node:assert/strict'
import test from 'node:test'
import { sessionId } from '@/src/domain/session'
import type { ManagedSessionRuntimePolicy } from '@/src/domain/managed-session'
import { createManagedSessionRuntimePolicyGuard } from './managed-session-runtime-policy'

function policy(
  resourcePolicyRevision: number,
  workingLocation: 'source-checkout' | 'session-worktree'
): ManagedSessionRuntimePolicy {
  return {
    workspaceId: 'workspace-a',
    workstreamId: 'workstream-a',
    sessionId: sessionId('session-a'),
    goal: 'Ship the Workstream goal',
    lifecycle: 'active',
    runLeaseId: 'lease-a',
    repositories: [
      {
        id: 'repository-a',
        name: 'Repository A',
        commonDirectoryPath: '/repositories/a/.git',
        role: '',
        relationships: [],
        validationCommands: [],
        availability: 'available',
        workingPath:
          workingLocation === 'source-checkout' ? '/repositories/a' : '/repositories/.worktrees/session-a/repository-a',
        workingLocation,
      },
    ],
    piSessionPath: '/sessions/session-a.jsonl',
    resourcePolicyRevision,
  }
}

test('keeps the managed runtime policy current after preparing a Repository', async () => {
  let currentPolicy = policy(1, 'source-checkout')
  const preparedWorkingPath = '/repositories/.worktrees/session-a/repository-a'
  const policyFailures: unknown[] = []
  const guard = createManagedSessionRuntimePolicyGuard(
    {
      policy: currentPolicy,
      resolvePolicy: async () => currentPolicy,
      prepareSessionRepository: async (repositoryId) => {
        currentPolicy = policy(2, 'session-worktree')

        return {
          repositoryId,
          workingPath: preparedWorkingPath,
          resourcePolicyRevision: currentPolicy.resourcePolicyRevision,
        }
      },
    },
    (error) => policyFailures.push(error)
  )

  await guard.prepareRepository('repository-a')
  const validated = await guard.validate()

  assert.equal(validated.repositories[0]?.availability, 'available')
  if (validated.repositories[0]?.availability === 'available') {
    assert.equal(validated.repositories[0].workingLocation, 'session-worktree')
  }
  assert.deepEqual(policyFailures, [])
})
