import assert from 'node:assert/strict'
import test from 'node:test'
import { applicationStateSchemaVersion, classifyApplicationState } from './application-state'

test('starts a genuine first launch only when neither authority file exists', () => {
  assert.deepEqual(classifyApplicationState(undefined, undefined), { status: 'first-launch' })
  assert.equal(classifyApplicationState({ generationId: 'a' }, undefined).status, 'recovery-only')
})

test('rejects a mismatched authority generation', () => {
  assert.equal(
    classifyApplicationState(
      { generationId: 'marker' },
      { generationId: 'database', schemaVersion: applicationStateSchemaVersion, integrity: 'ok' }
    ).status,
    'recovery-only'
  )
})
