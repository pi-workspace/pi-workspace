import assert from 'node:assert/strict'
import test from 'node:test'
import { parseUnifiedDiffHunks } from './diff-view'

test('parses independently referenceable unified diff hunks with their immutable patches', () => {
  const content = [
    'diff --git a/src/example.ts b/src/example.ts',
    '--- a/src/example.ts',
    '+++ b/src/example.ts',
    '@@ -2,2 +2,3 @@',
    ' unchanged',
    '-old',
    '+new',
    '+added',
    '@@ -20 +21 @@',
    '-before',
    '+after',
  ].join('\n')

  assert.deepEqual(parseUnifiedDiffHunks(content), [
    {
      id: '2:2:0',
      oldStart: 2,
      oldLines: 2,
      newStart: 2,
      newLines: 3,
      patch: '@@ -2,2 +2,3 @@\n unchanged\n-old\n+new\n+added',
    },
    {
      id: '20:21:1',
      oldStart: 20,
      oldLines: 1,
      newStart: 21,
      newLines: 1,
      patch: '@@ -20 +21 @@\n-before\n+after',
    },
  ])
})
