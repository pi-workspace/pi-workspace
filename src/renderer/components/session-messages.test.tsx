import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { browser } from '@/src/renderer/test-dom'
import { act, cleanup, render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { sessionId } from '@/src/domain/session'
import type { SessionTranscriptSnapshot } from '@/src/session-transcript'
import { SessionMessages } from './session-messages'

afterEach(() => cleanup())

const id = sessionId('session-a')

function transcript(entries: SessionTranscriptSnapshot['entries']): SessionTranscriptSnapshot {
  return { sessionId: id, revision: 1, isWorking: false, runs: [], entries }
}

test('shows a visible status while Session context is compacting', () => {
  const view = render(<SessionMessages sessionId={id} isWorking={false} isCompacting transcript={transcript([])} />, {
    container: browser.document.body as unknown as HTMLElement,
  })

  assert.equal(view.getByRole('status').textContent, 'Pi is compacting this Session…')
})

test('renders a compaction summary as a collapsed Markdown disclosure', async () => {
  const user = userEvent.setup({ document: browser.document as unknown as Document })
  const view = render(
    <SessionMessages
      sessionId={id}
      isWorking={false}
      transcript={{
        ...transcript([]),
        entries: [
          {
            type: 'compaction',
            compaction: {
              type: 'context-compaction',
              id: 'compaction-1',
              summary: '## Goal\nPreserve the **current implementation plan**.',
              timestamp: 1,
            },
          },
        ],
      }}
    />,
    { container: browser.document.body as unknown as HTMLElement }
  )

  const disclosure = view.getByText('Context compacted').closest('details')
  assert.ok(disclosure)
  assert.equal(disclosure.open, false)

  await user.click(view.getByText('Context compacted'))

  assert.equal(disclosure.open, true)
  assert.ok(await view.findByRole('heading', { name: 'Goal' }))
  assert.equal(view.getByText('current implementation plan').tagName, 'STRONG')
})

test('renders duplicate message text in canonical entry order', () => {
  const view = render(
    <SessionMessages
      sessionId={id}
      isWorking={false}
      transcript={transcript([
        { type: 'message', message: { id: 'user-1', role: 'user', text: 'Same text', state: 'complete', revision: 1 } },
        {
          type: 'message',
          message: { id: 'assistant-1', role: 'assistant', text: 'Same text', state: 'complete', revision: 1 },
        },
      ])}
    />,
    { container: browser.document.body as unknown as HTMLElement }
  )

  assert.equal(view.getAllByText('Same text', { exact: true }).length, 2)
})

test('offers to fork from each completed user message by its canonical position', async () => {
  const requestedPositions: number[] = []
  const view = render(
    <SessionMessages
      sessionId={id}
      isWorking={false}
      onForkFromMessage={(position) => requestedPositions.push(position)}
      transcript={transcript([
        { type: 'message', message: { id: 'user-1', role: 'user', text: 'First', state: 'complete', revision: 1 } },
        {
          type: 'message',
          message: { id: 'assistant-1', role: 'assistant', text: 'Response', state: 'complete', revision: 1 },
        },
        { type: 'message', message: { id: 'user-2', role: 'user', text: 'Second', state: 'complete', revision: 1 } },
      ])}
    />,
    { container: browser.document.body as unknown as HTMLElement }
  )

  await view.getByRole('button', { name: 'Fork from “Second”' }).click()

  assert.deepEqual(requestedPositions, [2])
})

test('renders a finished code review as a grouped transcript card', async () => {
  const user = userEvent.setup({ document: browser.document as unknown as Document })
  const view = render(
    <SessionMessages
      sessionId={id}
      isWorking={false}
      transcript={transcript([
        {
          type: 'message',
          message: {
            id: 'review-1',
            role: 'user',
            text: 'Formatted model context',
            codeReview: {
              kind: 'review',
              comments: [
                {
                  id: 'comment-1',
                  text: 'Keep the previous diff visible.',
                  createdAt: 1,
                  reference: {
                    repositoryId: 'repository-1',
                    repositoryName: 'Pi Workspace',
                    path: 'src/session-changes.tsx',
                    oldStart: 10,
                    oldLines: 2,
                    newStart: 10,
                    newLines: 3,
                    patch: '@@ -10,2 +10,3 @@\n-old\n+new',
                  },
                },
              ],
            },
            state: 'complete',
            revision: 1,
          },
        },
      ])}
    />,
    { container: browser.document.body as unknown as HTMLElement }
  )

  assert.ok(view.getByText('Finished review'))
  await user.click(view.getByText('src/session-changes.tsx'))
  assert.ok(view.getByText('Keep the previous diff visible.'))
  assert.ok(view.getByText('Lines +10–12'))
})

test('renders an invoked Skill inline with the user-authored transcript message', () => {
  const view = render(
    <SessionMessages
      sessionId={id}
      isWorking={false}
      transcript={transcript([
        {
          type: 'message',
          message: {
            id: 'user-1',
            role: 'user',
            text: 'Review this change.',
            skills: [
              {
                offset: 7,
                skill: {
                  name: 'code-review',
                  description: 'Review code changes.',
                  availability: 'available',
                },
              },
            ],
            state: 'complete',
            revision: 1,
          },
        },
      ])}
    />,
    { container: browser.document.body as unknown as HTMLElement }
  )

  assert.equal(view.getByText('code-review', { exact: true }).getAttribute('title'), 'Review code changes.')
  assert.ok(view.getByText('Review this change.', { exact: true }))
  assert.equal(view.queryByRole('button', { name: /Remove code-review Skill/ }), null)
})

test('keeps the name of an unavailable Skill in the transcript', () => {
  const view = render(
    <SessionMessages
      sessionId={id}
      isWorking={false}
      transcript={transcript([
        {
          type: 'message',
          message: {
            id: 'user-1',
            role: 'user',
            text: '',
            skills: [{ offset: 0, skill: { name: 'retired-skill', availability: 'unavailable' } }],
            state: 'complete',
            revision: 1,
          },
        },
      ])}
    />,
    { container: browser.document.body as unknown as HTMLElement }
  )

  assert.equal(
    view.getByText('retired-skill', { exact: true }).getAttribute('title'),
    'This Skill is no longer available.'
  )
})

test('labels a steering message separately from an ordinary user message', () => {
  const view = render(
    <SessionMessages
      sessionId={id}
      isWorking
      transcript={transcript([
        {
          type: 'message',
          message: {
            id: 'steer-1',
            role: 'user',
            text: 'Prioritize transcript delivery.',
            delivery: 'steer',
            state: 'complete',
            revision: 1,
          },
        },
      ])}
    />,
    { container: browser.document.body as unknown as HTMLElement }
  )

  assert.ok(view.getByText('Steering', { exact: true }))
  assert.ok(view.getByText('Prioritize transcript delivery.', { exact: true }))
})

test('hides a legacy mode-transition action card', () => {
  const view = render(
    <SessionMessages
      sessionId={id}
      isWorking={false}
      transcript={{
        ...transcript([]),
        actionCards: [
          {
            id: 'card-1',
            sessionId: id,
            kind: 'start-implement-session',
            title: 'Start implementation',
            description: 'Create an Implement Session.',
            status: 'available',
            createdAt: 1,
          },
        ],
      }}
    />,
    { container: browser.document.body as unknown as HTMLElement }
  )

  assert.equal(view.queryByText('Start implementation', { exact: true }), null)
})

test('offers only draft preparation for a pull-request action card', () => {
  const view = render(
    <SessionMessages
      sessionId={id}
      isWorking={false}
      transcript={{
        ...transcript([]),
        actionCards: [
          {
            id: 'card-1',
            sessionId: id,
            kind: 'prepare-pull-request',
            title: 'Prepare the pull request',
            description: 'The changes are ready for review.',
            status: 'available',
            createdAt: 1,
          },
        ],
      }}
    />,
    { container: browser.document.body as unknown as HTMLElement }
  )

  assert.ok(view.getByRole('button', { name: 'Prepare draft pull request' }))
  assert.equal(view.queryByRole('button', { name: 'Prepare pull request' }), null)
})

test('allows dismissing an available action card for later', async () => {
  let dismissedCardId: string | undefined
  const user = userEvent.setup({ document: browser.document as unknown as Document })
  const view = render(
    <SessionMessages
      sessionId={id}
      isWorking={false}
      transcript={{
        ...transcript([]),
        actionCards: [
          {
            id: 'card-1',
            sessionId: id,
            kind: 'prepare-pull-request',
            title: 'Prepare the pull request',
            description: 'The changes are ready for review.',
            status: 'available',
            createdAt: 1,
          },
        ],
      }}
      onDismissActionCard={async (card) => {
        dismissedCardId = card.id
        return true
      }}
    />,
    { container: browser.document.body as unknown as HTMLElement }
  )

  await user.click(view.getByRole('button', { name: 'Not now' }))

  assert.equal(dismissedCardId, 'card-1')
  assert.equal(view.queryByText('Prepare the pull request', { exact: true }), null)
})

test('allows retrying an action after its request fails', async () => {
  let attempts = 0
  const view = render(
    <SessionMessages
      sessionId={id}
      isWorking={false}
      transcript={{
        ...transcript([]),
        actionCards: [
          {
            id: 'card-1',
            sessionId: id,
            kind: 'prepare-pull-request',
            title: 'Prepare the pull request',
            description: 'Review the completed changes.',
            status: 'available',
            createdAt: 1,
          },
        ],
      }}
      onActionCard={async () => {
        attempts += 1
        throw new Error('Session unavailable')
      }}
    />,
    { container: browser.document.body as unknown as HTMLElement }
  )

  await act(async () => {
    await view.getByRole('button', { name: 'Prepare draft pull request' }).click()
  })
  assert.equal(attempts, 1)
  assert.ok(view.getByText('Could not start this request.', { exact: true }))

  await act(async () => {
    await view.getByRole('button', { name: 'Prepare draft pull request' }).click()
  })
  assert.equal(attempts, 2)
})

test('keeps a streaming assistant message in one identity when it completes', () => {
  const view = render(
    <SessionMessages
      sessionId={id}
      isWorking
      transcript={transcript([
        {
          type: 'message',
          message: { id: 'assistant-1', role: 'assistant', text: 'Draft', state: 'streaming', revision: 1 },
        },
      ])}
    />,
    { container: browser.document.body as unknown as HTMLElement }
  )

  view.rerender(
    <SessionMessages
      sessionId={id}
      isWorking={false}
      transcript={{
        ...transcript([
          {
            type: 'message',
            message: { id: 'assistant-1', role: 'assistant', text: 'Complete', state: 'complete', revision: 2 },
          },
        ]),
        revision: 2,
      }}
    />
  )

  assert.ok(view.getByText('Complete', { exact: true }))
  assert.equal(view.queryByText('Draft', { exact: true }), null)
})

test('confirms an allowed external link before opening it', async () => {
  const openedUrls: string[] = []
  window.piWorkspace = {
    transcript: {
      openExternalLink: async (url: string) => openedUrls.push(url),
      loadActivityDetails: async () => undefined,
    },
  } as unknown as typeof window.piWorkspace
  const view = render(
    <SessionMessages
      sessionId={id}
      isWorking={false}
      transcript={transcript([
        {
          type: 'message',
          message: {
            id: 'assistant-1',
            role: 'assistant',
            text: '[docs](https://example.com/docs)',
            state: 'complete',
            revision: 1,
          },
        },
      ])}
    />,
    { container: browser.document.body as unknown as HTMLElement }
  )

  await view.getByRole('button', { name: 'docs' }).click()
  assert.equal(openedUrls.length, 0)
  await view.getByRole('button', { name: 'Open link' }).click()
  assert.deepEqual(openedUrls, ['https://example.com/docs'])
})
