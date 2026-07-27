import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { sessionId } from '@/src/domain/session'
import type { OwnedSession } from '@/src/domain/workstream'
import { StartupScreen } from './startup-screen'

function recentSession(title: string, availability: 'available' | 'unavailable' = 'available'): OwnedSession {
  return {
    id: sessionId('session-a'),
    workstreamId: 'workstream-a',
    title,
    availability,
    repositoryAccess: { kind: 'managed' as const },
  }
}

test('hides recent Sessions when there are none', () => {
  const markup = renderToStaticMarkup(
    <StartupScreen
      recentSessions={[]}
      onActivateSession={() => {}}
      onCreateWorkstream={() => {}}
      onCreateQuickSession={() => {}}
      onOpenChangelog={() => {}}
    />
  )

  assert.doesNotMatch(markup, /Recent sessions/)
  assert.doesNotMatch(markup, /recent-sessions-heading/)
})

test('shows Workstream and Quick Session creation actions', () => {
  const markup = renderToStaticMarkup(
    <StartupScreen
      recentSessions={[]}
      onActivateSession={() => {}}
      onCreateWorkstream={() => {}}
      onCreateQuickSession={() => {}}
      onOpenChangelog={() => {}}
    />
  )

  assert.match(markup, />Create Workstream</)
  assert.match(markup, />Quick Session</)
})

test('shows recent Sessions as buttons', () => {
  const markup = renderToStaticMarkup(
    <StartupScreen
      recentSessions={[recentSession('Recent Session')]}
      onActivateSession={() => {}}
      onCreateWorkstream={() => {}}
      onCreateQuickSession={() => {}}
      onOpenChangelog={() => {}}
    />
  )

  assert.match(markup, /<button[^>]*type="button"[^>]*title="Recent Session"/)
})

test('keeps an unavailable recent Session visible, contextual, and disabled', () => {
  const markup = renderToStaticMarkup(
    <StartupScreen
      recentSessions={[recentSession('Unavailable Session', 'unavailable')]}
      onActivateSession={() => {}}
      onCreateWorkstream={() => {}}
      onCreateQuickSession={() => {}}
      onOpenChangelog={() => {}}
    />
  )

  assert.match(markup, /Unavailable Session/)
  assert.match(markup, /Session history unavailable/)
  assert.match(markup, /<button[^>]*disabled=""/)
})

test('visually truncates a long recent Session title while preserving the full title', () => {
  const title = 'A Session title that is much longer than the available space on the startup screen'
  const markup = renderToStaticMarkup(
    <StartupScreen
      recentSessions={[recentSession(title)]}
      onActivateSession={() => {}}
      onCreateWorkstream={() => {}}
      onCreateQuickSession={() => {}}
      onOpenChangelog={() => {}}
    />
  )

  assert.match(markup, /class="[^"]*\btruncate\b[^"]*"/)
  assert.match(markup, new RegExp(`title="${title}"`))
})
