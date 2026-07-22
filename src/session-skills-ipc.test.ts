import assert from 'node:assert/strict'
import test from 'node:test'
import { sessionId } from '@/src/domain/session'
import { parseSessionSkillsRequest } from '@/src/session-skills-ipc'

test('accepts a narrow serializable Session Skills request', () => {
  assert.deepEqual(parseSessionSkillsRequest({ sessionId: 'session-a' }), { sessionId: sessionId('session-a') })
})

test('rejects an invalid Session Skills request', () => {
  assert.equal(parseSessionSkillsRequest({ sessionId: '' }), undefined)
})
