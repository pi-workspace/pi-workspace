import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseApplicationUpdateCommand } from './application-update-ipc'

test('accepts only supported argument-free application update commands', () => {
  assert.equal(parseApplicationUpdateCommand('check'), 'check')
  assert.equal(parseApplicationUpdateCommand('download'), 'download')
  assert.equal(parseApplicationUpdateCommand('restart'), 'restart')
  assert.equal(parseApplicationUpdateCommand('open-release'), 'open-release')
  assert.equal(parseApplicationUpdateCommand('install'), undefined)
  assert.equal(parseApplicationUpdateCommand({ command: 'check' }), undefined)
})
