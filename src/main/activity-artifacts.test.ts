import assert from 'node:assert/strict'
import test from 'node:test'
import type { ToolExecution } from '@/src/session-timeline'
import { deriveActivityArtifacts, deriveMutationPreview } from './activity-artifacts'

function execution(toolName: string, input: unknown, status: ToolExecution['status'] = 'completed'): ToolExecution {
  return {
    toolCallId: 'tool-1',
    activityId: 'activity-1',
    toolName,
    label: toolName,
    status,
    input,
  }
}

const repositories = [{ repositoryId: 'repository-a', workingPath: '/work/repository-a' }]

test('attributes changed files to a Repository without exposing absolute paths', () => {
  const artifacts = deriveActivityArtifacts(
    execution('edit', { path: '/work/repository-a/src/file.ts' }),
    { details: { patch: '@@ -1 +1 @@\n-old\n+new' } },
    '/runtime',
    false,
    repositories
  )

  assert.deepEqual(artifacts, [
    { type: 'file-change', path: 'src/file.ts', repositoryId: 'repository-a', additions: 1, deletions: 1 },
  ])
})

test('derives immutable edit diffs and exact write snapshots', () => {
  const editPreview = deriveMutationPreview(
    execution('edit', { path: '/work/repository-a/src/file.ts' }),
    { details: { patch: '@@ -1 +1 @@\n-old\n+new' } },
    '/runtime',
    repositories
  )
  const writePreview = deriveMutationPreview(
    execution('write', { path: '/work/repository-a/src/new.ts', content: 'export const value = 1\n' }),
    {},
    '/runtime',
    repositories
  )

  assert.deepEqual(editPreview, {
    kind: 'diff',
    path: 'src/file.ts',
    repositoryId: 'repository-a',
    content: '@@ -1 +1 @@\n-old\n+new',
    truncated: false,
  })
  assert.deepEqual(writePreview, {
    kind: 'code',
    path: 'src/new.ts',
    repositoryId: 'repository-a',
    content: 'export const value = 1\n',
    truncated: false,
  })
})

test('derives an apply-patch preview from its operation-time patch result', () => {
  const input = {
    patch: '*** Begin Patch\n*** Update File: /work/repository-a/src/file.ts\n*** End Patch',
  }
  const preview = deriveMutationPreview(
    execution('apply_patch', input),
    { details: { patch: '@@ -1 +1 @@\n-old\n+new' } },
    '/runtime',
    repositories
  )

  assert.equal(preview?.path, 'src/file.ts')
  assert.equal(preview?.kind, 'diff')
})

test('does not derive mutation previews for failed or unattributed operations', () => {
  assert.equal(
    deriveMutationPreview(execution('edit', { path: '/outside/file.ts' }, 'failed'), {}, '/runtime', repositories),
    undefined
  )
  assert.equal(deriveMutationPreview(execution('read', { path: '/runtime/file.ts' }), {}, '/runtime'), undefined)
})
