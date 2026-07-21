import assert from 'node:assert/strict'
import test from 'node:test'
import {
  parseEffortSelection,
  parseModelSelection,
  parseSessionConfigurationRequest,
  sessionConfigurationIpcChannels,
} from './session-configuration-ipc'
import { sessionId } from '@/src/domain/session'

test('accepts a Session Configuration snapshot request', () => {
  assert.deepEqual(parseSessionConfigurationRequest({ sessionId: 'session-a' }), { sessionId: 'session-a' })
})

test('accepts a narrow Model selection request', () => {
  assert.deepEqual(parseModelSelection({ sessionId: 'session-a', model: { provider: 'openai', id: 'gpt-5' } }), {
    sessionId: 'session-a',
    model: { provider: 'openai', id: 'gpt-5' },
  })
})

test('accepts a narrow Effort selection request', () => {
  assert.deepEqual(parseEffortSelection({ sessionId: 'session-a', effort: 'high' }), {
    sessionId: 'session-a',
    effort: 'high',
  })
})

test('rejects an invalid Session Configuration snapshot request', () => {
  assert.equal(parseSessionConfigurationRequest({ sessionId: '' }), undefined)
})

test('rejects an invalid Model selection request', () => {
  assert.equal(parseModelSelection({ sessionId: 'session-a', model: { provider: '', id: 'gpt-5' } }), undefined)
})

test('rejects an invalid Effort selection request', () => {
  assert.equal(parseEffortSelection({ sessionId: 'session-a', effort: 'maximum' }), undefined)
})

test('uses a Session-specific channel for configuration changes', () => {
  assert.equal(
    sessionConfigurationIpcChannels.changed(sessionId('session-a')),
    'session-configuration:changed:session-a'
  )
})
