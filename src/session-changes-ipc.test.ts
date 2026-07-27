import assert from 'node:assert/strict'
import test from 'node:test'
import { sessionId } from '@/src/domain/session'
import { parseSessionFileDiffRequest, parseSessionFileStageRequest } from './session-changes-ipc'

const id = sessionId('session-a')

test('accepts only bounded Session file diff requests', () => {
  assert.deepEqual(
    parseSessionFileDiffRequest({
      sessionId: id,
      repositoryId: 'repository-a',
      path: 'src/file.ts',
      view: 'staged',
    }),
    { sessionId: id, repositoryId: 'repository-a', path: 'src/file.ts', view: 'staged' }
  )
  assert.equal(
    parseSessionFileDiffRequest({ sessionId: id, repositoryId: '', path: 'src/file.ts', view: 'all' }),
    undefined
  )
  assert.equal(
    parseSessionFileDiffRequest({
      sessionId: id,
      repositoryId: 'repository-a',
      path: 'x'.repeat(8_193),
      view: 'all',
    }),
    undefined
  )
  assert.equal(
    parseSessionFileDiffRequest({ sessionId: id, repositoryId: 'repository-a', path: 'src/file.ts', view: 'raw' }),
    undefined
  )
})

test('accepts only explicit Session file staging requests', () => {
  assert.deepEqual(
    parseSessionFileStageRequest({
      sessionId: id,
      repositoryId: 'repository-a',
      path: 'src/file.ts',
      staged: true,
    }),
    { sessionId: id, repositoryId: 'repository-a', path: 'src/file.ts', staged: true }
  )
  assert.equal(
    parseSessionFileStageRequest({ sessionId: id, repositoryId: 'repository-a', path: 'src/file.ts' }),
    undefined
  )
  assert.equal(
    parseSessionFileStageRequest({
      sessionId: id,
      repositoryId: 'repository-a',
      path: 'src/file.ts',
      staged: 'yes',
    }),
    undefined
  )
})
