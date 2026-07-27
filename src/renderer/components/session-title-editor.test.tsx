import { browser } from '@/src/renderer/test-dom'
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { useState } from 'react'
import { sessionId } from '@/src/domain/session'
import type { OwnedSession } from '@/src/domain/workstream'
import { SessionArea } from './session-area'
import { WorkstreamNavigation } from './workstream-navigation'
import { SessionContainer } from './session-container'
import { SessionTitleEditor } from './session-title-editor'

const session: OwnedSession = {
  id: sessionId('session-a'),
  workstreamId: 'workstream-a',
  title: 'First Session',
  availability: 'available',
  repositoryAccess: { kind: 'managed' as const },
}

function renderInBrowser(element: React.ReactNode) {
  return render(element, { container: browser.document.body as unknown as HTMLElement })
}

function RevealSessionArea() {
  const [composerFocusRequest, setComposerFocusRequest] =
    useState<Readonly<{ sessionId: typeof session.id; request: number }>>()

  return (
    <SessionArea
      sessions={[session]}
      activeSessionId={session.id}
      revealRequest={{ sessionId: session.id, request: 1 }}
      composerFocusRequest={composerFocusRequest}
      drafts={new Map()}
      pinnedSessionIds={[]}
      onSessionRevealed={(sessionId) => setComposerFocusRequest({ sessionId, request: 1 })}
      onActivateSession={() => {}}
      onDraftChange={() => {}}
      submitMessage={async () => ({ status: 'accepted', delivery: 'prompt' })}
      onToggleSessionPin={() => {}}
    />
  )
}

afterEach(() => cleanup())

test('the header exposes a keyboard-reachable title edit action', () => {
  const markup = renderToStaticMarkup(
    <SessionContainer
      session={session}
      workstreamLifecycle="active"
      active={false}
      draft=""
      pinned={false}
      onStartTitleEditing={() => {}}
      onTitleChange={() => {}}
      onSaveTitle={() => {}}
      onCancelTitleEditing={() => {}}
      onActivate={() => {}}
      onDraftChange={() => {}}
      submitMessage={async () => ({ status: 'accepted', delivery: 'prompt' })}
      onTogglePin={() => {}}
    />
  )

  assert.match(markup, /aria-label="Edit title for First Session"/)
})

test('selects the published title and uses Enter and Escape for inline editing', async () => {
  const saves: string[] = []
  const cancellations: string[] = []
  const view = renderInBrowser(
    <SessionTitleEditor
      title="First Session"
      saving={false}
      onChange={() => {}}
      onSave={() => saves.push('save')}
      onCancel={() => cancellations.push('cancel')}
    />
  )
  const input = view.getByRole('textbox', { name: 'Session title' }) as HTMLInputElement

  await waitFor(() => assert.equal(browser.document.activeElement?.getAttribute('aria-label'), 'Session title'))
  assert.equal(input.selectionStart, 0)
  assert.equal(input.selectionEnd, 'First Session'.length)
  fireEvent.keyDown(input, { key: 'Enter' })
  fireEvent.keyDown(input, { key: 'Escape' })
  fireEvent.blur(input)

  assert.deepEqual(saves, ['save'])
  assert.deepEqual(cancellations, ['cancel'])
})

test('marks an invalid title with the semantic error border without adding inline text', () => {
  const markup = renderToStaticMarkup(
    <SessionTitleEditor
      title=" "
      error="Enter a title with visible characters."
      saving={false}
      onChange={() => {}}
      onSave={() => {}}
      onCancel={() => {}}
    />
  )

  assert.match(markup, /border-composer-error-foreground/)
  assert.match(markup, /focus-visible:ring-composer-error-foreground/)
  assert.doesNotMatch(markup, /Enter a title with visible characters\./)
})

test('does not save composition Enter events', () => {
  const saves: string[] = []
  const view = renderInBrowser(
    <SessionTitleEditor
      title="First Session"
      saving={false}
      onChange={() => {}}
      onSave={() => saves.push('save')}
      onCancel={() => {}}
    />
  )
  const input = view.getByRole('textbox', { name: 'Session title' })

  fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
  fireEvent.keyDown(input, { key: 'Enter' })

  assert.deepEqual(saves, ['save'])
})

test('double-clicking a sidebar title starts editing without activating or pinning the Session', async () => {
  const starts: string[] = []
  const activations: string[] = []
  const pins: string[] = []
  const view = renderInBrowser(
    <WorkstreamNavigation
      activeSessionId={session.id}
      pinnedSessionIds={[]}
      repositories={[]}
      workingSessionIds={new Set()}
      workstreams={[
        {
          id: 'workstream-a',
          workspaceId: 'workspace-a',
          goal: 'Ship the change',
          lifecycle: 'active',
          workingLocation: 'current-checkouts',
          repositoryWorkingLocations: [],
          sessions: [session],
        },
      ]}
      onStartTitleEditing={(id) => starts.push(id)}
      onTitleChange={() => {}}
      onSaveTitle={() => {}}
      onCancelTitleEditing={() => {}}
      onActivateSession={(id) => activations.push(id)}
      onCreateWorkstream={async () => {}}
      onCreateQuickSession={async () => {}}
      onCreateSession={async () => {}}
      onPreviewWorktreeLocations={async () => ({ workstreamId: 'preview', repositories: [] })}
      onSetWorkstreamLifecycle={async () => {}}
      onSelectWorkstream={() => {}}
      onToggleSessionPin={(id) => pins.push(id)}
    />
  )

  fireEvent.doubleClick(view.getByText('First Session'))

  assert.deepEqual(starts, [session.id])
  assert.deepEqual(activations, [])
  assert.deepEqual(pins, [])
})

test('reveals the requested Session before focusing its Composer', async () => {
  Object.assign(browser, {
    piWorkspace: {
      transcript: {
        getSnapshot: async (id: typeof session.id) => ({
          sessionId: id,
          revision: 0,
          isWorking: false,
          runs: [],
          entries: [],
        }),
        getWorkingStateSnapshots: async () => [],
        loadActivityDetails: async () => undefined,
        subscribe: () => () => {},
      },
    },
  })
  const scrollCalls: Element[] = []
  const originalScrollIntoView = HTMLElement.prototype.scrollIntoView
  HTMLElement.prototype.scrollIntoView = function () {
    scrollCalls.push(this)
  }

  try {
    renderInBrowser(<RevealSessionArea />)

    await waitFor(() => assert.equal(scrollCalls.length, 1))
    await waitFor(() =>
      assert.equal(browser.document.activeElement?.getAttribute('aria-label'), 'Message for First Session')
    )
  } finally {
    HTMLElement.prototype.scrollIntoView = originalScrollIntoView
  }
})
