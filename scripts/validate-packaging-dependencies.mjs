import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const asarMinimatch = require('../node_modules/@electron/asar/node_modules/minimatch')
const universalMinimatch = await import('../node_modules/@electron/universal/node_modules/minimatch/dist/esm/index.js')
const expectedExpansion = ['a', 'b']

assert.deepEqual(
  asarMinimatch.braceExpand('{a,b}'),
  expectedExpansion,
  '@electron/asar must support its installed brace-expansion version.'
)
assert.deepEqual(
  universalMinimatch.braceExpand('{a,b}'),
  expectedExpansion,
  '@electron/universal must support its installed brace-expansion version.'
)

console.log('Packaging dependency contracts valid.')
