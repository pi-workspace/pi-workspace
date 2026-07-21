import assert from 'node:assert/strict'
import { test } from 'node:test'
import { initialMainContentState, updateMainContent } from './main-content'

test('starts at the Startup Screen without unread Changelog state', () => {
  assert.deepEqual(initialMainContentState, { destination: 'startup' })
})

test('Back returns from Changelog to the Startup Screen', () => {
  const changelogState = updateMainContent(initialMainContentState, { type: 'open-changelog' })

  assert.equal(updateMainContent(changelogState, { type: 'return-to-startup' }).destination, 'startup')
})

test('activating a Session leaves Changelog', () => {
  const changelogState = updateMainContent(initialMainContentState, { type: 'open-changelog' })

  assert.equal(updateMainContent(changelogState, { type: 'activate-session' }).destination, 'startup')
})
