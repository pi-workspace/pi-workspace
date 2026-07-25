import assert from 'node:assert/strict'
import test from 'node:test'
import { createSettingsSnapshot, parseSettings, parseSettingsUpdate } from './settings'

test('parses saved theme and appearance preferences', () => {
  assert.deepEqual(parseSettings({ appearance: 'dark', theme: 'one' }), {
    appearance: 'dark',
    theme: 'one',
  })
})

test('defaults the theme for saved appearance preferences from before themes', () => {
  assert.deepEqual(parseSettings({ appearance: 'dark' }), {
    appearance: 'dark',
    theme: 'railyard',
  })
})

test('migrates a saved Pi Workspace theme preference to Railyard', () => {
  assert.deepEqual(parseSettings({ appearance: 'dark', theme: 'pi-workspace' }), {
    appearance: 'dark',
    theme: 'railyard',
  })
})

test('rejects malformed saved settings instead of treating them as valid preferences', () => {
  assert.equal(parseSettings({ appearance: 'sepia', theme: 'one' }), undefined)
  assert.equal(parseSettings({ appearance: 'dark', theme: 'one', extra: true }), undefined)
  assert.equal(parseSettings(null), undefined)
})

test('accepts independent appearance and theme updates', () => {
  assert.deepEqual(parseSettingsUpdate({ appearance: 'light' }), { appearance: 'light' })
  assert.deepEqual(parseSettingsUpdate({ theme: 'one' }), { theme: 'one' })
})

test('rejects unsupported settings updates', () => {
  assert.equal(parseSettingsUpdate({ appearance: 'sepia' }), undefined)
  assert.equal(parseSettingsUpdate({}), undefined)
})

test('resolves the current color scheme without changing the saved appearance preference', () => {
  assert.deepEqual(createSettingsSnapshot({ appearance: 'system', theme: 'railyard' }, true), {
    appearance: 'system',
    theme: 'railyard',
    resolvedColorScheme: 'dark',
  })
})

test('resolves a dark-only theme to dark without changing the saved appearance preference', () => {
  assert.deepEqual(createSettingsSnapshot({ appearance: 'light', theme: 'dracula' }, false), {
    appearance: 'light',
    theme: 'dracula',
    resolvedColorScheme: 'dark',
  })
})
