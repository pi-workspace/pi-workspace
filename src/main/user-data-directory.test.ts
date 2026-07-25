import assert from 'node:assert/strict'
import { basename, dirname, join } from 'node:path'
import { test } from 'node:test'
import { resolveUserDataDirectory } from './user-data-directory'

test('uses the normal Railyard user-data directory without a development space', () => {
  assert.equal(resolveUserDataDirectory('/application-data'), join('/application-data', 'Railyard'))
})

test('uses a stable, portable directory for a development space', () => {
  const directory = resolveUserDataDirectory('/application-data', 'feature/session cards')

  assert.equal(dirname(directory), join('/application-data', 'Railyard Development'))
  assert.match(basename(directory), /^feature-session-cards-[a-f0-9]{16}$/)
})

test('keeps development spaces separate', () => {
  const firstDirectory = resolveUserDataDirectory('/application-data', 'action-cards')
  const secondDirectory = resolveUserDataDirectory('/application-data', 'compact')

  assert.notEqual(firstDirectory, secondDirectory)
})
