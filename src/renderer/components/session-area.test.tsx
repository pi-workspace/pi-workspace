import assert from 'node:assert/strict'
import test from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { sessionId } from '@/src/domain/session'
import type { OwnedSession } from '@/src/domain/workstream'
import { SessionArea } from './session-area'

const pinnedSession: OwnedSession = {
  id: sessionId('pinned-session'),
  workstreamId: 'workstream-a',
  title: 'Pinned Session',
  mode: 'brainstorm',
  availability: 'available',
  repositoryAccess: { kind: 'managed' as const },
}

const activeSession: OwnedSession = {
  id: sessionId('active-session'),
  workstreamId: 'workstream-a',
  title: 'Active Session',
  mode: 'implement',
  availability: 'available',
  repositoryAccess: { kind: 'managed' as const },
}

const emptyDrafts = new Map()
const submitMessage = async () => ({ status: 'accepted', delivery: 'prompt' }) as const

function renderSession(session: OwnedSession, pinned = false): string {
  return renderToStaticMarkup(
    <SessionArea
      sessions={[session]}
      activeSessionId={session.id}
      drafts={emptyDrafts}
      pinnedSessionIds={pinned ? [session.id] : []}
      onActivateSession={() => {}}
      onDraftChange={() => {}}
      submitMessage={submitMessage}
      onToggleSessionPin={() => {}}
    />
  )
}

test('renders every visible Session', () => {
  const markup = renderToStaticMarkup(
    <SessionArea
      sessions={[pinnedSession, activeSession]}
      activeSessionId={activeSession.id}
      drafts={emptyDrafts}
      pinnedSessionIds={[pinnedSession.id]}
      onActivateSession={() => {}}
      onDraftChange={() => {}}
      submitMessage={submitMessage}
      onToggleSessionPin={() => {}}
    />
  )

  assert.match(markup, /Pinned Session/)
  assert.match(markup, /Active Session/)
})

test('exposes the pin state for each visible Session', () => {
  const markup = renderToStaticMarkup(
    <SessionArea
      sessions={[pinnedSession, activeSession]}
      activeSessionId={activeSession.id}
      drafts={emptyDrafts}
      pinnedSessionIds={[pinnedSession.id]}
      onActivateSession={() => {}}
      onDraftChange={() => {}}
      submitMessage={submitMessage}
      onToggleSessionPin={() => {}}
    />
  )

  assert.match(markup, /aria-label="Unpin Pinned Session" aria-pressed="true"/)
  assert.match(markup, /aria-label="Pin Active Session" aria-pressed="false"/)
})

test('marks only the active Session header as active', () => {
  const markup = renderToStaticMarkup(
    <SessionArea
      sessions={[pinnedSession, activeSession]}
      activeSessionId={activeSession.id}
      drafts={emptyDrafts}
      pinnedSessionIds={[pinnedSession.id]}
      onActivateSession={() => {}}
      onDraftChange={() => {}}
      submitMessage={submitMessage}
      onToggleSessionPin={() => {}}
    />
  )

  assert.equal(markup.match(/data-active="true"/g)?.length, 1)
  assert.match(markup, /data-active="true"[\s\S]*Active Session/)
})

test('keeps the Composer available for a Quick Session with direct Repository access', () => {
  const defaultSession: OwnedSession = {
    ...activeSession,
    id: sessionId('quick-session'),
    title: 'Quick Session',
    mode: 'default',
    repositoryAccess: {
      kind: 'direct',
      repositoryId: 'repository-a',
      repositoryName: 'Repository A',
      availability: 'available',
    },
  }
  const markup = renderToStaticMarkup(
    <SessionArea
      sessions={[defaultSession]}
      activeSessionId={defaultSession.id}
      drafts={emptyDrafts}
      pinnedSessionIds={[]}
      onActivateSession={() => {}}
      onDraftChange={() => {}}
      submitMessage={submitMessage}
      onToggleSessionPin={() => {}}
    />
  )

  assert.match(markup, /Repository A/)
  assert.doesNotMatch(markup, /Default/)
  assert.match(markup, /aria-label="Send message"/)
  assert.doesNotMatch(markup, /Repository access must be proposed/)
})

test('keeps the Composer available for a managed Session', () => {
  const pendingSession = {
    ...activeSession,
    mode: 'implement' as const,
    availability: 'available' as const,
    repositoryAccess: { kind: 'managed' as const },
  }
  const markup = renderToStaticMarkup(
    <SessionArea
      sessions={[pendingSession]}
      activeSessionId={pendingSession.id}
      drafts={emptyDrafts}
      pinnedSessionIds={[]}
      onActivateSession={() => {}}
      onDraftChange={() => {}}
      submitMessage={submitMessage}
      onToggleSessionPin={() => {}}
    />
  )

  assert.match(markup, /aria-label="Send message"/)
})

test('explains unavailable direct Repository checkout separately from Session history', () => {
  const unavailableCheckout: OwnedSession = {
    id: sessionId('quick-session'),
    workstreamId: 'quick-workstream',
    title: 'Quick Session',
    mode: 'default',
    availability: 'available',
    repositoryAccess: {
      kind: 'direct',
      repositoryId: 'repository-a',
      repositoryName: 'Repository A',
      availability: 'unavailable',
    },
  }

  const markup = renderSession(unavailableCheckout)

  assert.match(markup, /This Session’s Repository checkout is unavailable\./)
  assert.doesNotMatch(markup, /history file/)
  assert.doesNotMatch(markup, /aria-label="Send message"/)
})

test('explains when both Session history and direct Repository checkout are unavailable', () => {
  const unavailableSession: OwnedSession = {
    id: sessionId('quick-session'),
    workstreamId: 'quick-workstream',
    title: 'Quick Session',
    mode: 'default',
    availability: 'unavailable',
    repositoryAccess: {
      kind: 'direct',
      repositoryId: 'repository-a',
      repositoryName: 'Repository A',
      availability: 'unavailable',
    },
  }

  assert.match(renderSession(unavailableSession), /history file and Repository checkout are unavailable/)
})

test('disables title editing for an unavailable Session', () => {
  const unavailableSession: OwnedSession = { ...activeSession, availability: 'unavailable' }

  assert.match(renderSession(unavailableSession), /aria-label="Edit title for Active Session"[^>]*disabled=""/)
})

test('disables pinning an unavailable Session from its pane', () => {
  const unavailableSession: OwnedSession = { ...activeSession, availability: 'unavailable' }

  assert.match(renderSession(unavailableSession), /aria-label="Pin Active Session"[^>]*disabled=""/)
})

test('allows an unavailable pinned Session to be unpinned from its pane', () => {
  const unavailableSession: OwnedSession = { ...activeSession, availability: 'unavailable' }
  const markup = renderSession(unavailableSession, true)

  assert.match(markup, /aria-label="Unpin Active Session"/)
  assert.doesNotMatch(markup, /aria-label="Unpin Active Session"[^>]*disabled=""/)
})

test('replaces the Composer with restore guidance for an archived Workstream', () => {
  const markup = renderToStaticMarkup(
    <SessionArea
      sessions={[activeSession]}
      workstreamLifecycles={new Map([['workstream-a', 'archived']])}
      activeSessionId={activeSession.id}
      drafts={emptyDrafts}
      pinnedSessionIds={[]}
      onActivateSession={() => {}}
      onDraftChange={() => {}}
      submitMessage={submitMessage}
      onToggleSessionPin={() => {}}
    />
  )

  assert.match(markup, /Restore this Workstream to continue/)
  assert.doesNotMatch(markup, /aria-label="Send message"/)
})

test('constrains every visible Session so its transcript scrolls without displacing its Composer', () => {
  const markup = renderToStaticMarkup(
    <SessionArea
      sessions={[pinnedSession, activeSession]}
      activeSessionId={activeSession.id}
      drafts={emptyDrafts}
      pinnedSessionIds={[pinnedSession.id]}
      onActivateSession={() => {}}
      onDraftChange={() => {}}
      submitMessage={submitMessage}
      onToggleSessionPin={() => {}}
    />
  )

  assert.match(markup, /class="flex min-h-0 min-w-\[400px\] flex-\[1_0_400px\]/)
  assert.match(markup, /class="composer-tray shrink-0 border-t/)
})
