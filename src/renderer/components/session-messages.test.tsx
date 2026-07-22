import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { browser } from '@/src/renderer/test-dom'
import { cleanup, render } from '@testing-library/react'
import { sessionId } from '@/src/domain/session'
import type { SessionTranscriptSnapshot } from '@/src/session-transcript'
import { SessionMessages } from './session-messages'

afterEach(() => cleanup())

const id = sessionId('session-a')

function transcript(entries: SessionTranscriptSnapshot['entries']): SessionTranscriptSnapshot {
  return { sessionId: id, revision: 1, isWorking: false, runs: [], entries }
}

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
