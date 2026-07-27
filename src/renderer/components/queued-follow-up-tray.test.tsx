import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { sessionId } from '@/src/domain/session'
import { browser } from '@/src/renderer/test-dom'
import { QueuedFollowUpTray } from './queued-follow-up-tray'

afterEach(() => cleanup())

const id = sessionId('session-a')

function renderInBrowser(element: React.ReactNode) {
  return render(element, { container: browser.document.body as unknown as HTMLElement })
}

test('expands queued follow-ups on hover and removes the selected item', async () => {
  const removedFollowUps: string[] = []
  const user = userEvent.setup({ document: browser.document as unknown as Document })
  const view = renderInBrowser(
    <QueuedFollowUpTray
      sessionId={id}
      isWorking={false}
      queuedFollowUps={[
        { id: 'follow-up-1', text: 'Send this next.', createdAt: 1 },
        { id: 'follow-up-2', text: 'Send this after that.', createdAt: 2 },
      ]}
      removeQueuedFollowUp={async (_sessionId, followUpId) => {
        removedFollowUps.push(followUpId)
        return true
      }}
    />
  )

  assert.equal(view.queryAllByRole('button', { name: 'Remove queued follow-up' }).length, 0)

  await user.hover(view.getByText('Next follow-up'))

  assert.equal(view.getAllByRole('button', { name: 'Remove queued follow-up' }).length, 2)

  await act(async () => {
    fireEvent.click(view.getAllByRole('button', { name: 'Remove queued follow-up' })[0]!)
    await new Promise<void>((resolve) => window.setTimeout(() => resolve(), 30))
  })

  assert.deepEqual(removedFollowUps, ['follow-up-1'])
})

test('expands a working queue from the keyboard', async () => {
  const user = userEvent.setup({ document: browser.document as unknown as Document })
  const view = renderInBrowser(
    <QueuedFollowUpTray
      sessionId={id}
      isWorking
      queuedFollowUps={[
        { id: 'follow-up-1', text: 'Send this next.', createdAt: 1 },
        { id: 'follow-up-2', text: 'Send this after that.', createdAt: 2 },
      ]}
      removeQueuedFollowUp={async () => true}
    />
  )

  assert.equal(view.queryAllByRole('button', { name: 'Remove queued follow-up' }).length, 0)

  await user.tab()

  assert.equal(
    view.getByRole('button', { name: /Next follow-up Send this next/ }).getAttribute('aria-expanded'),
    'true'
  )
  assert.equal(view.getAllByRole('button', { name: 'Remove queued follow-up' }).length, 2)
})

test('renders queued Skill tokens as Skill references', () => {
  const view = renderInBrowser(
    <QueuedFollowUpTray
      sessionId={id}
      isWorking
      queuedFollowUps={[
        {
          id: 'follow-up-1',
          text: '/skill:tdd Write the focused test.',
          skills: [
            {
              offset: 0,
              skill: { name: 'tdd', description: 'Develop test first.', availability: 'available' },
            },
          ],
          createdAt: 1,
        },
      ]}
    />
  )

  assert.ok(view.container.querySelector('[data-skill-reference="tdd"]'))
  assert.equal(view.queryByText('/skill:tdd'), null)
  assert.match(view.container.textContent ?? '', /Write the focused test\./)
})

test('summarizes a queued referenced follow-up by file and comment', () => {
  const view = render(
    <QueuedFollowUpTray
      sessionId={id}
      isWorking
      queuedFollowUps={[
        {
          id: 'follow-up-1',
          text: 'Formatted model context',
          createdAt: 1,
          codeReview: {
            kind: 'follow-up',
            comments: [
              {
                id: 'comment-1',
                text: 'Keep this visible.',
                createdAt: 1,
                reference: {
                  repositoryId: 'repository-1',
                  repositoryName: 'Pi Workspace',
                  path: 'src/session-changes.tsx',
                  oldStart: 1,
                  oldLines: 1,
                  newStart: 1,
                  newLines: 1,
                  patch: '@@ -1 +1 @@\n-old\n+new',
                },
              },
            ],
          },
        },
      ]}
    />,
    { container: browser.document.body as unknown as HTMLElement }
  )

  assert.match(view.getByText(/Next follow-up/).textContent ?? '', /src\/session-changes.tsx/)
  assert.ok(view.getByText('Keep this visible.'))
})

test('reveals only the next three queued follow-ups', async () => {
  const user = userEvent.setup({ document: browser.document as unknown as Document })
  const view = renderInBrowser(
    <QueuedFollowUpTray
      sessionId={id}
      isWorking={false}
      queuedFollowUps={Array.from({ length: 5 }, (_, index) => ({
        id: `follow-up-${index}`,
        text: `Queued message ${index + 1}`,
        createdAt: index,
      }))}
    />
  )

  await user.hover(view.getByText('Next follow-up'))

  assert.equal(view.container.querySelectorAll('li').length, 3)
  assert.ok(view.getByText('Next follow-up'))
  assert.ok(view.getByText('Queued message 1'))
  assert.equal(view.queryByText('Queued message 4'), null)
})

test('shows Resume only for a paused idle queue', () => {
  const view = renderInBrowser(
    <QueuedFollowUpTray
      sessionId={id}
      isWorking={false}
      queuedFollowUps={[{ id: 'follow-up-1', text: 'Send this next.', createdAt: 1 }]}
      resumeQueuedFollowUps={async () => true}
    />
  )

  assert.equal(view.queryByRole('button', { name: 'Resume' }), null)

  view.rerender(
    <QueuedFollowUpTray
      sessionId={id}
      isWorking
      queuedFollowUps={[{ id: 'follow-up-1', text: 'Send this next.', createdAt: 1 }]}
      queuedFollowUpsPaused
      resumeQueuedFollowUps={async () => true}
    />
  )

  assert.equal(view.queryByRole('button', { name: 'Resume' }), null)
})

test('resumes queued follow-ups when the Session is idle', async () => {
  const resumedSessions: string[] = []
  const user = userEvent.setup({ document: browser.document as unknown as Document })
  const view = renderInBrowser(
    <QueuedFollowUpTray
      sessionId={id}
      isWorking={false}
      queuedFollowUps={[{ id: 'follow-up-1', text: 'Send this next.', createdAt: 1 }]}
      queuedFollowUpsPaused
      resumeQueuedFollowUps={async (sessionId) => {
        resumedSessions.push(sessionId)
        return true
      }}
    />
  )

  await user.click(view.getByRole('button', { name: 'Resume' }))
  await new Promise<void>((resolve) => window.setTimeout(() => resolve(), 30))

  assert.deepEqual(resumedSessions, [id])
})
