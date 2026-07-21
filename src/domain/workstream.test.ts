import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeSessionMode, normalizeWorkstreamGoal, sessionModes } from './workstream'

test('requires a visible Workstream goal', () => {
  assert.throws(() => normalizeWorkstreamGoal('   '), /goal is required/)
})

test('normalizes a Workstream goal without changing its meaning', () => {
  assert.equal(normalizeWorkstreamGoal('  Ship cancellation reasons  '), 'Ship cancellation reasons')
})

test('supports the standard Pi mode used by Quick Sessions', () => {
  assert.equal(sessionModes.includes('default'), true)
})

test('defaults a Session mode to Implement', () => {
  assert.equal(normalizeSessionMode(), 'implement')
})

test('preserves an explicit Brainstorm Session mode', () => {
  assert.equal(normalizeSessionMode('brainstorm'), 'brainstorm')
})
