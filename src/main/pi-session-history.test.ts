import assert from 'node:assert/strict'
import test from 'node:test'
import { classifyPersistedAgentState } from '@/src/main/pi-session-history'

test('a terminal tool-free assistant message proves successful completion', () => {
  assert.equal(classifyPersistedAgentState({ stopReason: 'stop', content: [{ type: 'text' }] }), 'completed')
})

test('a tool-use assistant message does not prove successful completion', () => {
  assert.equal(classifyPersistedAgentState({ stopReason: 'toolUse', content: [{ type: 'toolCall' }] }), 'indeterminate')
})

test('an assistant provider error proves final failure', () => {
  assert.equal(classifyPersistedAgentState({ stopReason: 'error', content: [] }), 'failed')
})

test('an aborted assistant message proves cancellation', () => {
  assert.equal(classifyPersistedAgentState({ stopReason: 'aborted', content: [] }), 'cancelled')
})
