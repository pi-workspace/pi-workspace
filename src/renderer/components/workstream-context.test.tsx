import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { sessionId } from '@/src/domain/session'
import type { OwnedSession, Workstream } from '@/src/domain/workstream'
import type { PiWorkspaceBridge } from '@/src/pi-workspace'
import { browser } from '@/src/renderer/test-dom'
import { WorkstreamContextLayout, WorkstreamSelectionScreen } from './workstream-context'

const workstream: Workstream = {
  id: 'workstream-a',
  workspaceId: 'workspace-a',
  goal: 'Ship cancellation reasons',
  lifecycle: 'active',
  workingLocation: 'current-checkouts',
  repositoryWorkingLocations: [],
  sessions: [],
}

const activeSession: OwnedSession = {
  id: sessionId('session-a'),
  workstreamId: workstream.id,
  title: 'Implement changes',
  availability: 'available',
  repositoryAccess: { kind: 'managed' },
}

afterEach(cleanup)

test('guides a selected Workstream toward its Sessions without exposing knowledge', () => {
  const markup = renderToStaticMarkup(<WorkstreamSelectionScreen workstream={workstream} />)

  assert.match(markup, /Ship cancellation reasons/)
  assert.match(markup, /Select a Session to continue/)
  assert.doesNotMatch(markup, /knowledge/i)
})

test('shows only Changes in the resizable utility panel', async () => {
  const originalRect = Object.getOwnPropertyDescriptor(browser.window.HTMLElement.prototype, 'getBoundingClientRect')
  Object.defineProperty(browser.window.HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      width: 1_000,
      height: 800,
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 1_000,
      bottom: 800,
    }),
  })
  Object.defineProperty(browser.window, 'piWorkspace', {
    configurable: true,
    value: {
      sessionChanges: {
        async getSnapshot(requestedSessionId: ReturnType<typeof sessionId>) {
          return { sessionId: requestedSessionId, repositories: [] }
        },
        async loadFileDiff() {
          return { status: 'unavailable', message: 'Unavailable.' }
        },
      },
      transcript: { subscribe: () => () => {} },
    } as unknown as PiWorkspaceBridge,
  })

  try {
    const view = render(
      <WorkstreamContextLayout activeSession={activeSession}>
        <div>Active Session</div>
      </WorkstreamContextLayout>,
      { container: browser.document.body as unknown as HTMLElement }
    )

    const separator = await waitFor(() => view.getByRole('separator', { name: 'Resize Changes panel' }))
    assert.ok(view.getAllByText('Changes').length >= 1)
    assert.equal(view.queryByText('Knowledge'), null)
    assert.equal(separator.getAttribute('aria-valuenow'), '520')

    fireEvent.keyDown(separator, { key: 'ArrowLeft' })
    assert.equal(separator.getAttribute('aria-valuenow'), '540')
  } finally {
    if (originalRect) {
      Object.defineProperty(browser.window.HTMLElement.prototype, 'getBoundingClientRect', originalRect)
    } else {
      Reflect.deleteProperty(browser.window.HTMLElement.prototype, 'getBoundingClientRect')
    }
  }
})
