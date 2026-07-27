import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeWorkstreamGoal } from './workstream'

test('requires a visible Workstream goal', () => {
  assert.throws(() => normalizeWorkstreamGoal('   '), /goal is required/)
})

test('normalizes a Workstream goal without changing its meaning', () => {
  assert.equal(normalizeWorkstreamGoal('  Ship cancellation reasons  '), 'Ship cancellation reasons')
})
