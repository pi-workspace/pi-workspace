import assert from 'node:assert/strict'
import test from 'node:test'
import { adjustSidebarWidth, clampSidebarWidth } from './sidebar-width'

test('keeps the sidebar width within its supported range', () => {
  assert.equal(clampSidebarWidth(200), 240)
  assert.equal(clampSidebarWidth(320), 320)
  assert.equal(clampSidebarWidth(520), 480)
})

test('adjusts the sidebar width without exceeding its supported range', () => {
  assert.equal(adjustSidebarWidth(320, 16), 336)
  assert.equal(adjustSidebarWidth(472, 16), 480)
  assert.equal(adjustSidebarWidth(248, -16), 240)
})
