import assert from 'node:assert/strict'
import { test } from 'node:test'
import { validateBetaReleaseVersion } from './release-version'

test('accepts a numbered beta semantic version', () => {
  assert.deepEqual(validateBetaReleaseVersion('0.1.0-beta.1'), [])
})

test('rejects a stable version for a beta release', () => {
  assert.match(validateBetaReleaseVersion('0.1.0').join('\n'), /prerelease/i)
})

test('rejects an invalid semantic version for a beta release', () => {
  assert.match(validateBetaReleaseVersion('beta-one').join('\n'), /semantic version/i)
})

test('rejects a non-beta prerelease version for a beta release', () => {
  assert.match(validateBetaReleaseVersion('0.1.0-rc.1').join('\n'), /beta/i)
})
