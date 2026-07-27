import assert from 'node:assert/strict'
import { test } from 'node:test'
import { projectSessionFileSelections, replaceSessionFileTokens, sessionFileToken } from './session-files'

test('projects file tags while preserving surrounding text', () => {
  assert.deepEqual(projectSessionFileSelections('Review @src/app.ts and @src/components'), {
    text: 'Review  and ',
    selections: [
      { path: 'src/app.ts', offset: 7, tokenLength: 11 },
      { path: 'src/components', offset: 12, tokenLength: 15 },
    ],
  })
})

test('only treats standalone at-signs as file tags', () => {
  assert.deepEqual(projectSessionFileSelections('email@example.com @@literal x@example.com'), {
    text: 'email@example.com @@literal x@example.com',
    selections: [],
  })
})

test('projects quoted file tags for paths containing whitespace', () => {
  assert.deepEqual(projectSessionFileSelections('Review @@"src/my file.ts".'), {
    text: 'Review .',
    selections: [{ path: 'src/my file.ts', offset: 7, tokenLength: 18 }],
  })
  assert.equal(sessionFileToken('src/my file.ts'), '@@"src/my file.ts"')
})

test('replaces file tokens and rejects unresolved paths', () => {
  assert.equal(
    replaceSessionFileTokens('Read @src/app.ts', (path) => `FILE(${path})`),
    'Read FILE(src/app.ts)'
  )
  assert.equal(
    replaceSessionFileTokens('Read @missing.ts', () => undefined),
    undefined
  )
})
