import assert from 'node:assert/strict'
import test from 'node:test'
import { createSettingsSnapshot, parseSettings, parseSettingsUpdate } from './settings'

test('parses a saved appearance preference', () => {
  assert.deepEqual(parseSettings({ appearance: 'dark' }), {
    appearance: 'dark',
  })
})

test('rejects malformed saved settings instead of treating them as valid preferences', () => {
  assert.equal(parseSettings({ appearance: 'sepia' }), undefined)
  assert.equal(parseSettings({ appearance: 'dark', extra: true }), undefined)
  assert.equal(parseSettings(null), undefined)
})

test('accepts an appearance-only settings update', () => {
  assert.deepEqual(parseSettingsUpdate({ appearance: 'light' }), {
    appearance: 'light',
  })
})

test('rejects unsupported settings updates', () => {
  assert.equal(parseSettingsUpdate({ appearance: 'sepia' }), undefined)
  assert.equal(parseSettingsUpdate({}), undefined)
})

test('resolves the current color scheme without changing the saved appearance preference', () => {
  assert.deepEqual(createSettingsSnapshot({ appearance: 'system' }, true), {
    appearance: 'system',
    resolvedColorScheme: 'dark',
  })
})
