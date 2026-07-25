import assert from 'node:assert/strict'
import test from 'node:test'
import { parseSessionActionCardToolInput } from './session-action-cards'

test('accepts an allowlisted action card', () => {
  assert.deepEqual(
    parseSessionActionCardToolInput({
      kind: 'prepare-pull-request',
      title: 'Create a pull request',
      description: 'Prepare a draft for review.',
    }),
    {
      kind: 'prepare-pull-request',
      title: 'Create a pull request',
      description: 'Prepare a draft for review.',
    }
  )
})

test('rejects unknown action kinds', () => {
  assert.equal(
    parseSessionActionCardToolInput({ kind: 'run-shell-command', title: 'Run it', description: 'Run a command.' }),
    undefined
  )
})
