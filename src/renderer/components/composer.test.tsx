import { browser } from '@/src/renderer/test-dom'
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import type { ComposerBridge } from '@/src/composer'
import { sessionId, type Session, type SessionId } from '@/src/domain/session'
import type { OwnedSession } from '@/src/domain/workstream'
import type { SessionConfigurationBridge, SessionConfigurationSnapshot } from '@/src/session-configuration'
import type { SessionSkillsBridge } from '@/src/session-skills'
import type { SessionFilesBridge } from '@/src/session-files'
import { Composer } from './composer'
import { SessionArea } from './session-area'

const session: Session = {
  id: sessionId('session-a'),
  title: 'First Session',
}

afterEach(() => cleanup())

function StatefulComposer({
  initialDraft,
  isWorking = false,
  submitMessage,
}: {
  initialDraft: string
  isWorking?: boolean
  submitMessage: ComposerBridge['submit']
}) {
  const [draft, setDraft] = useState(initialDraft)

  return (
    <Composer
      session={session}
      draft={draft}
      isWorking={isWorking}
      onActivate={() => {}}
      onDraftChange={setDraft}
      submitMessage={submitMessage}
    />
  )
}

function SkillComposer({
  initialDraft = '/',
  submitMessage,
  sessionSkills,
}: {
  initialDraft?: string
  submitMessage: ComposerBridge['submit']
  sessionSkills: SessionSkillsBridge
}) {
  const [draft, setDraft] = useState(initialDraft)

  return (
    <Composer
      session={session}
      draft={draft}
      isWorking={false}
      onActivate={() => {}}
      onDraftChange={setDraft}
      submitMessage={submitMessage}
      sessionSkills={sessionSkills}
    />
  )
}

function DelayedDraftPublicationComposer({ submitMessage }: { submitMessage: ComposerBridge['submit'] }) {
  const [publishedDraft, setPublishedDraft] = useState('/')

  return (
    <>
      <button type="button" onClick={() => setPublishedDraft('/skill:code-review Re')}>
        Publish older draft
      </button>
      <Composer
        session={session}
        draft={publishedDraft}
        isWorking={false}
        onActivate={() => {}}
        onDraftChange={() => {}}
        submitMessage={submitMessage}
        sessionSkills={{
          async getAvailable() {
            return [{ name: 'code-review', description: 'Review code changes.' }]
          },
        }}
      />
    </>
  )
}

function FileComposer({
  initialDraft = '',
  submitMessage,
  sessionFiles,
}: {
  initialDraft?: string
  submitMessage: ComposerBridge['submit']
  sessionFiles: SessionFilesBridge
}) {
  const [draft, setDraft] = useState(initialDraft)

  return (
    <Composer
      session={session}
      draft={draft}
      isWorking={false}
      onActivate={() => {}}
      onDraftChange={setDraft}
      submitMessage={submitMessage}
      sessionFiles={sessionFiles}
    />
  )
}

function ownedSession(candidate: Session): OwnedSession {
  return {
    ...candidate,
    workstreamId: 'workstream-a',
    mode: 'implement',
    availability: 'available',
    repositoryAccess: { kind: 'managed' as const },
  }
}

function PinnedSessionArea({
  sessions,
  submitMessage,
}: {
  sessions: readonly Session[]
  submitMessage: ComposerBridge['submit']
}) {
  const [drafts, setDrafts] = useState<ReadonlyMap<SessionId, string>>(
    () => new Map(sessions.map((candidate, index) => [candidate.id, index === 0 ? 'First draft' : 'Second draft']))
  )

  return (
    <SessionArea
      sessions={sessions.map(ownedSession)}
      activeSessionId={sessions[1]?.id}
      drafts={drafts}
      pinnedSessionIds={sessions.map((candidate) => candidate.id)}
      onActivateSession={() => {}}
      onDraftChange={(id, draft) => {
        setDrafts((currentDrafts) => new Map(currentDrafts).set(id, draft))
      }}
      submitMessage={submitMessage}
      onToggleSessionPin={() => {}}
    />
  )
}

function NavigatingSessionArea({ sessions }: { sessions: readonly Session[] }) {
  const [activeSessionId, setActiveSessionId] = useState(sessions[0]?.id)
  const [drafts, setDrafts] = useState<ReadonlyMap<SessionId, string>>(() => new Map())
  const activeSession = sessions.find((candidate) => candidate.id === activeSessionId)

  return (
    <>
      {sessions.map((candidate) => (
        <button key={candidate.id} type="button" onClick={() => setActiveSessionId(candidate.id)}>
          Open {candidate.title}
        </button>
      ))}
      {activeSession && (
        <Composer
          session={activeSession}
          draft={drafts.get(activeSession.id) ?? ''}
          isWorking={false}
          onActivate={() => setActiveSessionId(activeSession.id)}
          onDraftChange={(draft) => setDrafts((currentDrafts) => new Map(currentDrafts).set(activeSession.id, draft))}
          submitMessage={async () => ({ status: 'accepted', delivery: 'prompt' })}
        />
      )}
    </>
  )
}

function renderInBrowser(element: React.ReactNode) {
  return render(element, { container: browser.document.body as unknown as HTMLElement })
}

function createUser() {
  return userEvent.setup({ document: browser.document as unknown as Document })
}

function composerText(editor: HTMLElement): string {
  return (editor.textContent ?? '').replaceAll('\u00a0', ' ').trimEnd()
}

function sessionConfigurationSnapshot(): SessionConfigurationSnapshot {
  return {
    sessionId: session.id,
    revision: 0,
    models: [
      { provider: 'openai', providerName: 'OpenAI', id: 'gpt-5', name: 'GPT-5' },
      { provider: 'openai', providerName: 'OpenAI', id: 'gpt-5-mini', name: 'GPT-5 mini' },
    ],
    model: { provider: 'openai', id: 'gpt-5' },
    effort: 'high',
    supportedEfforts: ['low', 'high'],
  }
}

test('Enter submits the exact draft to the owning Session once', async () => {
  const submissions: unknown[] = []
  const user = createUser()
  const view = renderInBrowser(
    <Composer
      session={session}
      draft="Keep  internal spaces"
      isWorking={false}
      onActivate={() => {}}
      onDraftChange={() => {}}
      submitMessage={async (submission) => {
        submissions.push(submission)
        return { status: 'accepted', delivery: 'prompt' }
      }}
    />
  )
  const editor = view.getByRole('textbox', { name: 'Message for First Session' })

  await user.click(editor)
  await user.keyboard('{Enter}')

  assert.deepEqual(submissions, [{ sessionId: session.id, text: 'Keep  internal spaces', delivery: 'steer' }])
})

test('selects a whitespace path from at-sign autocomplete and sends its canonical tag', async () => {
  const submissions: Parameters<ComposerBridge['submit']>[0][] = []
  const user = createUser()
  const view = renderInBrowser(
    <FileComposer
      submitMessage={async (submission) => {
        submissions.push(submission)
        return { status: 'accepted', delivery: 'prompt' }
      }}
      sessionFiles={{
        async getAvailable() {
          return [{ path: 'src/my file.ts', name: 'my file.ts', kind: 'file' }]
        },
      }}
    />
  )

  const editor = view.getByRole('textbox')
  await user.click(editor)
  await user.keyboard('@')
  await waitFor(() => assert.ok(view.getByRole('option', { name: /src\/my file\.ts/ })), { timeout: 3_000 })
  await user.keyboard('{Enter}')
  await user.click(view.getByRole('button', { name: 'Send message' }))

  await waitFor(() =>
    assert.deepEqual(submissions, [{ sessionId: session.id, text: '@@"src/my file.ts"', delivery: 'steer' }])
  )
})

test('closes file autocomplete after selecting a file', async () => {
  const user = createUser()
  const view = renderInBrowser(
    <FileComposer
      initialDraft="@"
      submitMessage={async () => ({ status: 'accepted', delivery: 'prompt' })}
      sessionFiles={{
        async getAvailable() {
          return [{ path: 'README.md', name: 'README.md', kind: 'file' }]
        },
      }}
    />
  )
  const editor = view.getByRole('textbox')

  await user.click(editor)
  await view.findByRole('listbox', { name: 'Files and folders' })
  await user.keyboard('r')
  await view.findByRole('option', { name: /README\.md/ })
  await user.keyboard('{Enter}')
  await act(async () => {
    await new Promise<void>((resolve) => window.setTimeout(resolve, 30))
  })

  assert.equal(Boolean(view.queryByRole('listbox', { name: 'Files and folders' })), false)
})

test('keeps the caret after an inserted file reference', async () => {
  const user = createUser()
  const view = renderInBrowser(
    <FileComposer
      initialDraft="Review "
      submitMessage={async () => ({ status: 'accepted', delivery: 'prompt' })}
      sessionFiles={{
        async getAvailable() {
          return [{ path: 'README.md', name: 'README.md', kind: 'file' }]
        },
      }}
    />
  )
  const editor = view.getByRole('textbox')

  await user.click(editor)
  await user.keyboard('@README')
  await user.keyboard('{Enter}')
  await user.click(editor)
  await user.keyboard(' next')

  assert.equal(composerText(editor), 'Review @README.md next')
})

test('scrolls the file results during keyboard navigation', async () => {
  const originalScrollIntoView = HTMLElement.prototype.scrollIntoView
  HTMLElement.prototype.scrollIntoView = () => {}

  try {
    const user = createUser()
    const view = renderInBrowser(
      <FileComposer
        initialDraft="@"
        submitMessage={async () => ({ status: 'accepted', delivery: 'prompt' })}
        sessionFiles={{
          async getAvailable() {
            return Array.from({ length: 12 }, (_, index) => ({
              path: `src/file-${index + 1}.ts`,
              name: `file-${index + 1}.ts`,
              kind: 'file' as const,
            }))
          },
        }}
      />
    )
    const editor = view.getByRole('textbox')

    await user.click(editor)
    const listbox = await view.findByRole('listbox', { name: 'Files and folders' })
    const options = view.getAllByRole('option')

    Object.defineProperties(listbox, {
      clientHeight: { configurable: true, value: 120 },
      scrollTop: { configurable: true, value: 0, writable: true },
    })
    options.forEach((option, index) => {
      Object.defineProperties(option, {
        offsetHeight: { configurable: true, value: 40 },
        offsetTop: { configurable: true, value: index * 40 },
      })
    })

    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}')

    await waitFor(() => assert.ok(listbox.scrollTop > 0))
  } finally {
    HTMLElement.prototype.scrollIntoView = originalScrollIntoView
  }
})

test('selects a Skill from autocomplete and sends it without prompt text', async () => {
  const submissions: unknown[] = []
  const user = createUser()
  const view = renderInBrowser(
    <SkillComposer
      sessionSkills={{
        async getAvailable() {
          return [{ name: 'code-review', description: 'Review code changes.' }]
        },
      }}
      submitMessage={async (submission) => {
        submissions.push(submission)
        return { status: 'accepted', delivery: 'prompt' }
      }}
    />
  )
  const editor = view.getByRole('textbox', { name: 'Message for First Session' })

  await user.click(editor)
  await view.findByRole('option', { name: /code-review/ })
  await user.keyboard('{Enter}')

  assert.ok(view.getByRole('button', { name: 'Remove code-review Skill' }))
  await user.keyboard('{Enter}')

  assert.deepEqual(submissions, [{ sessionId: session.id, text: '/skill:code-review', delivery: 'steer' }])
})

test('inserts one visible space after a selected Skill', async () => {
  const user = createUser()
  const view = renderInBrowser(
    <SkillComposer
      initialDraft="Use "
      sessionSkills={{
        async getAvailable() {
          return [{ name: 'code-review', description: 'Review code changes.' }]
        },
      }}
      submitMessage={async () => ({ status: 'accepted', delivery: 'prompt' })}
    />
  )
  const editor = view.getByRole('textbox', { name: 'Message for First Session' })

  await user.click(editor)
  await user.keyboard('/code')
  await user.keyboard('{Enter}')

  assert.equal(editor.textContent, 'Use code-review\u00a0')

  await user.keyboard(' next')
  assert.equal(editor.textContent?.replaceAll('\u00a0', ' '), 'Use code-review next')
})

test('keeps the caret after an inserted Skill', async () => {
  const user = createUser()
  const view = renderInBrowser(
    <SkillComposer
      initialDraft="Use "
      sessionSkills={{
        async getAvailable() {
          return [{ name: 'code-review', description: 'Review code changes.' }]
        },
      }}
      submitMessage={async () => ({ status: 'accepted', delivery: 'prompt' })}
    />
  )
  const editor = view.getByRole('textbox', { name: 'Message for First Session' })

  await user.click(editor)
  await user.keyboard('/code')
  await user.keyboard('{Enter}')
  await user.keyboard(' next')

  assert.equal(composerText(editor), 'Use code-review next')
})

test('keeps prompt text typed after a selected Skill', async () => {
  const submissions: unknown[] = []
  const user = createUser()
  const view = renderInBrowser(
    <SkillComposer
      sessionSkills={{
        async getAvailable() {
          return [{ name: 'code-review', description: 'Review code changes.' }]
        },
      }}
      submitMessage={async (submission) => {
        submissions.push(submission)
        return { status: 'accepted', delivery: 'prompt' }
      }}
    />
  )
  const editor = view.getByRole('textbox', { name: 'Message for First Session' })

  await user.click(editor)
  await user.keyboard('{Enter}')
  await user.click(editor)
  await user.keyboard('Review this change.')
  await user.click(view.getByRole('button', { name: 'Send message' }))

  assert.deepEqual(submissions, [
    { sessionId: session.id, text: '/skill:code-review Review this change.', delivery: 'steer' },
  ])
})

test('keeps newer local edits when its parent publishes an older draft', async () => {
  const submissions: unknown[] = []
  const user = createUser()
  const view = renderInBrowser(
    <DelayedDraftPublicationComposer
      submitMessage={async (submission) => {
        submissions.push(submission)
        return { status: 'accepted', delivery: 'prompt' }
      }}
    />
  )
  const editor = view.getByRole('textbox', { name: 'Message for First Session' })

  await user.click(editor)
  await user.keyboard('{Enter}')
  await user.click(editor)
  await user.keyboard('Review this change.')
  await user.click(view.getByRole('button', { name: 'Publish older draft' }))

  assert.equal(composerText(editor), 'code-review Review this change.')
  await user.click(view.getByRole('button', { name: 'Send message' }))

  assert.deepEqual(submissions, [
    { sessionId: session.id, text: '/skill:code-review Review this change.', delivery: 'steer' },
  ])
})

test('places a selected Skill where it was mentioned in the prompt', async () => {
  const user = createUser()
  const view = renderInBrowser(
    <SkillComposer
      initialDraft="Review with "
      sessionSkills={{
        async getAvailable() {
          return [{ name: 'code-review', description: 'Review code changes.' }]
        },
      }}
      submitMessage={async () => ({ status: 'accepted', delivery: 'prompt' })}
    />
  )
  const editor = view.getByRole('textbox', { name: 'Message for First Session' })

  await user.click(editor)
  await user.keyboard('/code')
  await user.click(await view.findByRole('option', { name: /code-review/ }))

  assert.equal(composerText(editor), 'Review with code-review')
})

test('associates Skill autocomplete and its active option with the Composer', async () => {
  const user = createUser()
  const view = renderInBrowser(
    <SkillComposer
      sessionSkills={{
        async getAvailable() {
          return [
            { name: 'code-review', description: 'Review code changes.' },
            { name: 'tdd', description: 'Develop test first.' },
          ]
        },
      }}
      submitMessage={async () => ({ status: 'accepted', delivery: 'prompt' })}
    />
  )
  const editor = view.getByRole('textbox', { name: 'Message for First Session' })

  await user.click(editor)
  const listbox = await view.findByRole('listbox', { name: 'Skills' })
  const activeOption = view.getByRole('option', { name: /code-review/ })

  assert.equal(editor.getAttribute('aria-autocomplete'), 'list')
  assert.equal(editor.getAttribute('aria-expanded'), 'true')
  assert.equal(editor.getAttribute('aria-controls'), listbox.id)
  assert.equal(editor.getAttribute('aria-activedescendant'), activeOption.id)

  await user.keyboard('{Escape}')
  assert.equal(editor.getAttribute('aria-expanded'), 'false')
  assert.equal(editor.hasAttribute('aria-activedescendant'), false)
})

test('scrolls the active Skill option into view during keyboard navigation', async () => {
  const originalScrollIntoView = HTMLElement.prototype.scrollIntoView
  const scrolledOptions: string[] = []
  HTMLElement.prototype.scrollIntoView = function () {
    scrolledOptions.push(this.textContent ?? '')
  }

  try {
    const user = createUser()
    const view = renderInBrowser(
      <SkillComposer
        sessionSkills={{
          async getAvailable() {
            return Array.from({ length: 12 }, (_, index) => ({
              name: `skill-${index + 1}`,
              description: `Skill ${index + 1}`,
            }))
          },
        }}
        submitMessage={async () => ({ status: 'accepted', delivery: 'prompt' })}
      />
    )
    const editor = view.getByRole('textbox', { name: 'Message for First Session' })

    await user.click(editor)
    await view.findByText('skill-1', { exact: true })
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}')

    assert.match(scrolledOptions.at(-1) ?? '', /^skill-8/)
  } finally {
    HTMLElement.prototype.scrollIntoView = originalScrollIntoView
  }
})

test('places Skill autocomplete above the Composer', async () => {
  const user = createUser()
  const view = renderInBrowser(
    <SkillComposer
      sessionSkills={{
        async getAvailable() {
          return [{ name: 'code-review', description: 'Review code changes.' }]
        },
      }}
      submitMessage={async () => ({ status: 'accepted', delivery: 'prompt' })}
    />
  )

  await user.click(view.getByRole('textbox', { name: 'Message for First Session' }))

  assert.equal((await view.findByRole('listbox', { name: 'Skills' })).getAttribute('data-placement'), 'top')
})

test('selects more than one Skill', async () => {
  const submissions: unknown[] = []
  const user = createUser()
  const view = renderInBrowser(
    <SkillComposer
      initialDraft="Use "
      sessionSkills={{
        async getAvailable() {
          return [
            { name: 'code-review', description: 'Review code changes.' },
            { name: 'tdd', description: 'Develop test first.' },
          ]
        },
      }}
      submitMessage={async (submission) => {
        submissions.push(submission)
        return { status: 'accepted', delivery: 'prompt' }
      }}
    />
  )
  const editor = view.getByRole('textbox', { name: 'Message for First Session' })

  await user.click(editor)
  await user.keyboard('/code')
  await user.click(await view.findByRole('option', { name: /code-review/ }))
  await user.click(editor)
  await user.keyboard(' and /tdd')
  await user.click(await view.findByRole('option', { name: /^tdd/ }))

  assert.equal(view.getAllByRole('button', { name: /Remove .* Skill/ }).length, 2)
  assert.equal(composerText(editor), 'Use code-review and tdd')

  await user.click(view.getByRole('button', { name: 'Send message' }))
  assert.deepEqual(submissions, [
    { sessionId: session.id, text: 'Use /skill:code-review and /skill:tdd', delivery: 'steer' },
  ])
})

test('selects a Skill at the caret without removing existing prompt text', async () => {
  const submissions: unknown[] = []
  const user = createUser()
  const view = renderInBrowser(
    <SkillComposer
      initialDraft="Review this change "
      sessionSkills={{
        async getAvailable() {
          return [{ name: 'code-review', description: 'Review code changes.' }]
        },
      }}
      submitMessage={async (submission) => {
        submissions.push(submission)
        return { status: 'accepted', delivery: 'prompt' }
      }}
    />
  )
  const editor = view.getByRole('textbox', { name: 'Message for First Session' })

  await user.click(editor)
  await user.keyboard('/code')
  await view.findByRole('option', { name: /code-review/ })
  await user.keyboard('{Enter}')
  await user.keyboard('{Enter}')

  assert.deepEqual(submissions, [
    { sessionId: session.id, text: 'Review this change /skill:code-review', delivery: 'steer' },
  ])
})

test('selecting a Skill preserves multiline prompt text', async () => {
  const submissions: unknown[] = []
  const user = createUser()
  const view = renderInBrowser(
    <SkillComposer
      initialDraft={'First line\nSecond line '}
      sessionSkills={{
        async getAvailable() {
          return [{ name: 'code-review', description: 'Review code changes.' }]
        },
      }}
      submitMessage={async (submission) => {
        submissions.push(submission)
        return { status: 'accepted', delivery: 'prompt' }
      }}
    />
  )
  const editor = view.getByRole('textbox', { name: 'Message for First Session' })

  await user.click(editor)
  await user.keyboard('/code')
  await view.findByRole('option', { name: /code-review/ })
  await user.keyboard('{Enter}')
  await user.keyboard('{Enter}')

  assert.deepEqual(submissions, [
    { sessionId: session.id, text: 'First line\nSecond line /skill:code-review', delivery: 'steer' },
  ])
})

test('Backspace removes a selected Skill from an empty Composer', async () => {
  const user = createUser()
  const view = renderInBrowser(
    <SkillComposer
      sessionSkills={{
        async getAvailable() {
          return [{ name: 'code-review', description: 'Review code changes.' }]
        },
      }}
      submitMessage={async () => ({ status: 'accepted', delivery: 'prompt' })}
    />
  )
  const editor = view.getByRole('textbox', { name: 'Message for First Session' })

  await user.click(editor)
  await user.keyboard('{Enter}')
  await user.keyboard('{Backspace}')

  assert.equal(view.queryByRole('button', { name: 'Remove code-review Skill' }), null)
  assert.equal(view.getByRole('button', { name: 'Send message' }).hasAttribute('disabled'), true)
  assert.equal(browser.document.activeElement, editor)
})

test('removes a selected Skill with Enter without submitting the prompt', async () => {
  const submissions: unknown[] = []
  const user = createUser()
  const view = renderInBrowser(
    <SkillComposer
      sessionSkills={{
        async getAvailable() {
          return [{ name: 'code-review', description: 'Review code changes.' }]
        },
      }}
      submitMessage={async (submission) => {
        submissions.push(submission)
        return { status: 'accepted', delivery: 'prompt' }
      }}
    />
  )

  await user.click(view.getByRole('textbox', { name: 'Message for First Session' }))
  await user.click(await view.findByRole('option', { name: /code-review/ }))

  view.getByRole('button', { name: 'Remove code-review Skill' }).focus()
  await user.keyboard('{Enter}')

  assert.deepEqual(submissions, [])
  assert.equal(view.queryByRole('button', { name: 'Remove code-review Skill' }), null)
})

test('removes a selected Skill with Space without submitting the prompt', async () => {
  const submissions: unknown[] = []
  const user = createUser()
  const view = renderInBrowser(
    <SkillComposer
      sessionSkills={{
        async getAvailable() {
          return [{ name: 'code-review', description: 'Review code changes.' }]
        },
      }}
      submitMessage={async (submission) => {
        submissions.push(submission)
        return { status: 'accepted', delivery: 'prompt' }
      }}
    />
  )

  await user.click(view.getByRole('textbox', { name: 'Message for First Session' }))
  await user.click(await view.findByRole('option', { name: /code-review/ }))

  view.getByRole('button', { name: 'Remove code-review Skill' }).focus()
  await user.keyboard(' ')

  assert.deepEqual(submissions, [])
  assert.equal(view.queryByRole('button', { name: 'Remove code-review Skill' }), null)
})

test('removes the selected Skill from its inline remove button', async () => {
  const user = createUser()
  const view = renderInBrowser(
    <SkillComposer
      sessionSkills={{
        async getAvailable() {
          return [{ name: 'code-review', description: 'Review code changes.' }]
        },
      }}
      submitMessage={async () => ({ status: 'accepted', delivery: 'prompt' })}
    />
  )

  await user.click(view.getByRole('textbox', { name: 'Message for First Session' }))
  await user.click(await view.findByRole('option', { name: /code-review/ }))
  await user.click(view.getByRole('button', { name: 'Remove code-review Skill' }))

  assert.equal(view.queryByRole('button', { name: 'Remove code-review Skill' }), null)
  assert.equal(view.getByRole('button', { name: 'Send message' }).hasAttribute('disabled'), true)
})

test('focuses the Composer when a new focus request arrives', async () => {
  renderInBrowser(
    <Composer
      session={session}
      draft=""
      focusRequest={1}
      isWorking={false}
      onActivate={() => {}}
      onDraftChange={() => {}}
      submitMessage={async () => ({ status: 'accepted', delivery: 'prompt' })}
    />
  )

  await waitFor(() =>
    assert.equal(browser.document.activeElement?.getAttribute('aria-label'), 'Message for First Session')
  )
})

test('restores Composer focus after the creation dialog restores its trigger', async () => {
  const view = renderInBrowser(
    <>
      <button type="button">Create Session</button>
      <Composer
        session={session}
        draft=""
        focusRequest={1}
        isWorking={false}
        onActivate={() => {}}
        onDraftChange={() => {}}
        submitMessage={async () => ({ status: 'accepted', delivery: 'prompt' })}
      />
    </>
  )
  const trigger = view.getByRole('button', { name: 'Create Session' })

  window.setTimeout(() => trigger.focus(), 100)

  await new Promise<void>((resolve) => window.setTimeout(() => resolve(), 110))
  assert.equal(browser.document.activeElement, trigger)

  await new Promise<void>((resolve) => window.setTimeout(() => resolve(), 30))
  assert.equal(browser.document.activeElement, view.getByRole('textbox'))
})

test('prevents Session actions while a Model change is pending', async () => {
  let resolveModelChange: () => void = () => {}
  const configuration = sessionConfigurationSnapshot()
  const bridge: SessionConfigurationBridge = {
    async getSnapshot() {
      return configuration
    },
    setModel() {
      return new Promise((resolve) => {
        resolveModelChange = () => resolve({ status: 'applied', snapshot: configuration })
      })
    },
    async setEffort() {
      return { status: 'applied', snapshot: configuration }
    },
    async dismissWarning() {
      return configuration
    },
    subscribe() {
      return () => {}
    },
  }
  const user = createUser()
  const view = renderInBrowser(
    <Composer
      session={session}
      draft="Send after configuration"
      isWorking={false}
      contextUsage={{ tokens: 48_000, contextWindow: 200_000, percent: 24, canCompact: true }}
      onActivate={() => {}}
      onDraftChange={() => {}}
      submitMessage={async () => ({ status: 'accepted', delivery: 'prompt' })}
      sessionConfiguration={bridge}
    />
  )

  const model = await view.findByRole('combobox', { name: 'Model' })
  await user.click(model)
  await user.keyboard('{ArrowDown}{Enter}')

  await waitFor(() =>
    assert.equal(
      view.getByRole('textbox', { name: 'Message for First Session' }).getAttribute('contenteditable'),
      'false'
    )
  )
  assert.equal((view.getByRole('button', { name: 'Send message' }) as HTMLButtonElement).disabled, true)
  assert.equal((view.getByRole('button', { name: 'Compact context' }) as HTMLButtonElement).disabled, true)

  act(() => resolveModelChange())

  await waitFor(() =>
    assert.equal((view.getByRole('button', { name: 'Send message' }) as HTMLButtonElement).disabled, false)
  )
})

test('shows the current context window usage in the Composer action cluster', () => {
  const view = renderInBrowser(
    <Composer
      session={session}
      draft=""
      isWorking={false}
      contextUsage={{ tokens: 48_000, contextWindow: 200_000, percent: 24 }}
      onActivate={() => {}}
      onDraftChange={() => {}}
      submitMessage={async () => ({ status: 'accepted', delivery: 'prompt' })}
    />
  )

  const contextWindow = view.getByRole('progressbar', { name: 'Context window' })

  const fill = contextWindow.querySelector('[data-slot="context-usage-fill"]') as HTMLElement

  assert.equal(fill.style.width, '24%')
  assert.match(contextWindow.textContent ?? '', /24%/)
  assert.equal(contextWindow.getAttribute('aria-valuenow'), '24')
  assert.equal(contextWindow.getAttribute('aria-valuetext'), '48k used of 200k tokens; 152k left')
  assert.equal(contextWindow.getAttribute('title'), '48k used of 200k tokens; 152k left')
  assert.equal(contextWindow.getAttribute('data-level'), 'nominal')
})

test('hides context compaction until the Session has enough context', () => {
  const view = renderInBrowser(
    <Composer
      session={session}
      draft=""
      isWorking={false}
      contextUsage={{ tokens: 2_000, contextWindow: 200_000, percent: 1, canCompact: false }}
      onActivate={() => {}}
      onDraftChange={() => {}}
      submitMessage={async () => ({ status: 'accepted', delivery: 'prompt' })}
    />
  )

  assert.equal(view.queryByRole('button', { name: 'Compact context' }), null)
})

test('disables the Composer while Session context is compacting', async () => {
  const configuration = sessionConfigurationSnapshot()
  const view = renderInBrowser(
    <Composer
      session={session}
      draft="Keep this draft"
      isWorking={false}
      isCompacting
      contextUsage={{ tokens: 48_000, contextWindow: 200_000, percent: 24 }}
      onActivate={() => {}}
      onDraftChange={() => {}}
      submitMessage={async () => ({ status: 'accepted', delivery: 'prompt' })}
      sessionConfiguration={{
        async getSnapshot() {
          return configuration
        },
        async setModel() {
          return { status: 'applied', snapshot: configuration }
        },
        async setEffort() {
          return { status: 'applied', snapshot: configuration }
        },
        async dismissWarning() {
          return configuration
        },
        subscribe() {
          return () => {}
        },
      }}
    />
  )

  assert.equal(
    view.getByRole('textbox', { name: 'Message for First Session' }).getAttribute('contenteditable'),
    'false'
  )
  assert.equal(view.getByRole('button', { name: 'Send message' }).hasAttribute('disabled'), true)
  assert.equal(((await view.findByRole('combobox', { name: 'Model' })) as HTMLButtonElement).disabled, true)
  assert.equal(view.queryByRole('button', { name: 'Compact context' }), null)
})

test('grows the context window fill in place so increments animate', () => {
  const composer = (percent: number) => (
    <Composer
      session={session}
      draft=""
      isWorking={false}
      contextUsage={{ tokens: 2_000 * percent, contextWindow: 200_000, percent }}
      onActivate={() => {}}
      onDraftChange={() => {}}
      submitMessage={async () => ({ status: 'accepted', delivery: 'prompt' })}
    />
  )
  const view = renderInBrowser(composer(24))
  const fill = view.container.querySelector('[data-slot="context-usage-fill"]')

  assert.ok(fill)
  assert.equal((fill as HTMLElement).style.width, '24%')

  view.rerender(composer(62))

  // The same element must survive the update; a replaced node would jump
  // straight to the new width with no transition to run.
  assert.equal(view.container.querySelector('[data-slot="context-usage-fill"]'), fill)
  assert.equal((fill as HTMLElement).style.width, '62%')
})

test('rounds the reported context window fraction for display', () => {
  const view = renderInBrowser(
    <Composer
      session={session}
      draft=""
      isWorking={false}
      contextUsage={{ tokens: 47_483, contextWindow: 200_000, percent: 23.7415 }}
      onActivate={() => {}}
      onDraftChange={() => {}}
      submitMessage={async () => ({ status: 'accepted', delivery: 'prompt' })}
    />
  )

  const contextWindow = view.getByRole('progressbar', { name: 'Context window' })

  const fill = contextWindow.querySelector('[data-slot="context-usage-fill"]') as HTMLElement

  assert.match(contextWindow.textContent ?? '', /^24%$/)
  assert.equal(contextWindow.getAttribute('aria-valuenow'), '24')
  assert.equal(fill.style.width, '23.7415%')
})

test('rolls a token count just short of a million over to millions', () => {
  const view = renderInBrowser(
    <Composer
      session={session}
      draft=""
      isWorking={false}
      contextUsage={{ tokens: 999_600, contextWindow: 1_000_000, percent: 99.96 }}
      onActivate={() => {}}
      onDraftChange={() => {}}
      submitMessage={async () => ({ status: 'accepted', delivery: 'prompt' })}
    />
  )

  const contextWindow = view.getByRole('progressbar', { name: 'Context window' })

  assert.equal(contextWindow.getAttribute('aria-valuetext'), '1m used of 1m tokens; 400 left')
})

test('escalates the context window usage level as the window fills', () => {
  const levels = [
    { percent: 74, level: 'nominal' },
    { percent: 75, level: 'caution' },
    { percent: 89, level: 'caution' },
    { percent: 90, level: 'critical' },
  ] as const

  for (const { percent, level } of levels) {
    const view = renderInBrowser(
      <Composer
        session={session}
        draft=""
        isWorking={false}
        contextUsage={{ tokens: 2_000 * percent, contextWindow: 200_000, percent }}
        onActivate={() => {}}
        onDraftChange={() => {}}
        submitMessage={async () => ({ status: 'accepted', delivery: 'prompt' })}
      />
    )

    const contextWindow = view.getByRole('progressbar', { name: 'Context window' })

    assert.equal(contextWindow.getAttribute('data-level'), level)
  }
})

test('hides context usage while Pi recalculates it after compaction', () => {
  const view = renderInBrowser(
    <Composer
      session={session}
      draft=""
      isWorking={false}
      contextUsage={{ tokens: null, contextWindow: 200_000, percent: null }}
      onActivate={() => {}}
      onDraftChange={() => {}}
      submitMessage={async () => ({ status: 'accepted', delivery: 'prompt' })}
    />
  )

  assert.equal(view.queryByRole('status'), null)
  assert.equal(view.queryByRole('progressbar', { name: 'Context window' }), null)
})

test('explains how to configure Pi when no Model is available while preserving the draft', async () => {
  const configuration = {
    sessionId: session.id,
    revision: 0,
    models: [],
    effort: 'off' as const,
    supportedEfforts: ['off'] as const,
  }
  const bridge: SessionConfigurationBridge = {
    async getSnapshot() {
      return configuration
    },
    async setModel() {
      return { status: 'applied', snapshot: configuration }
    },
    async setEffort() {
      return { status: 'applied', snapshot: configuration }
    },
    async dismissWarning() {
      return configuration
    },
    subscribe() {
      return () => {}
    },
  }
  const view = renderInBrowser(
    <Composer
      session={session}
      draft="Keep this draft"
      isWorking={false}
      onActivate={() => {}}
      onDraftChange={() => {}}
      submitMessage={async () => ({ status: 'accepted', delivery: 'prompt' })}
      sessionConfiguration={bridge}
    />
  )

  const editor = view.getByRole('textbox', { name: 'Message for First Session' })
  const send = view.getByRole('button', { name: 'Send message' }) as HTMLButtonElement

  await view.findByText('No Model is available. Install Pi CLI, sign in to a provider, then restart Railyard.')
  assert.equal(editor.textContent, 'Keep this draft')
  assert.equal(editor.getAttribute('contenteditable'), 'true')
  assert.equal(send.disabled, true)
})

test('associates unsupported Off Effort with the Composer status', async () => {
  const configuration = {
    ...sessionConfigurationSnapshot(),
    effort: 'off' as const,
    supportedEfforts: ['off'] as const,
    persistenceWarning: 'The selected Model may not survive reopening.',
  }
  const bridge: SessionConfigurationBridge = {
    async getSnapshot() {
      return configuration
    },
    async setModel() {
      return { status: 'applied', snapshot: configuration }
    },
    async setEffort() {
      return { status: 'applied', snapshot: configuration }
    },
    async dismissWarning() {
      return configuration
    },
    subscribe() {
      return () => {}
    },
  }
  const view = renderInBrowser(
    <Composer
      session={session}
      draft=""
      isWorking={false}
      onActivate={() => {}}
      onDraftChange={() => {}}
      submitMessage={async () => ({ status: 'accepted', delivery: 'prompt' })}
      sessionConfiguration={bridge}
    />
  )

  const model = await view.findByRole('combobox', { name: 'Model' })
  const effort = view.getByRole('button', { name: 'Effort' })
  const status = view.getByText('The selected Model may not survive reopening.')

  assert.equal(model.getAttribute('aria-describedby'), status.id)
  assert.equal(effort.getAttribute('aria-describedby'), status.id)
  assert.equal((effort as HTMLButtonElement).disabled, true)
  assert.equal(effort.textContent, 'Off')
})

test('keeps an unsent new Session draft when navigating away and back', async () => {
  const user = createUser()
  const newSession: Session = { id: sessionId('new-session'), title: 'New Session' }
  const existingSession: Session = { id: sessionId('existing-session'), title: 'Existing Session' }
  const view = renderInBrowser(<NavigatingSessionArea sessions={[newSession, existingSession]} />)
  const editor = view.getByRole('textbox', { name: 'Message for New Session' })
  const clipboard = new browser.DataTransfer()
  clipboard.setData('text/plain', 'Keep this draft')
  editor.focus()

  await act(async () => {
    fireEvent.paste(editor, { clipboardData: clipboard })
  })

  await waitFor(() => {
    assert.equal((view.getByRole('button', { name: 'Send message' }) as HTMLButtonElement).disabled, false)
  })

  await user.click(view.getByRole('button', { name: 'Open Existing Session' }))
  await user.click(view.getByRole('button', { name: 'Open New Session' }))

  await waitFor(() => {
    assert.equal(view.getByRole('textbox', { name: 'Message for New Session' }).textContent, 'Keep this draft')
  })
})

test('the Send button submits through the same path as Enter', async () => {
  const submissions: unknown[] = []
  const user = createUser()
  const view = renderInBrowser(
    <Composer
      session={session}
      draft="Send by pointer"
      isWorking={false}
      onActivate={() => {}}
      onDraftChange={() => {}}
      submitMessage={async (submission) => {
        submissions.push(submission)
        return { status: 'accepted', delivery: 'prompt' }
      }}
    />
  )

  await user.click(view.getByRole('button', { name: 'Send message' }))

  assert.deepEqual(submissions, [{ sessionId: session.id, text: 'Send by pointer', delivery: 'steer' }])
})

test('pointer Send activates its owning Session before submitting', async () => {
  const order: string[] = []
  const user = createUser()
  const view = renderInBrowser(
    <Composer
      session={session}
      draft="Activate first"
      isWorking={false}
      onActivate={() => order.push('activate')}
      onDraftChange={() => {}}
      submitMessage={async () => {
        order.push('submit')
        return { status: 'accepted', delivery: 'prompt' }
      }}
    />
  )

  await user.click(view.getByRole('button', { name: 'Send message' }))

  assert.deepEqual(order.slice(0, 2), ['activate', 'submit'])
})

test('Shift+Enter inserts a line break without submitting', async () => {
  const submissions: unknown[] = []
  const drafts: string[] = []
  const user = createUser()
  const view = renderInBrowser(
    <Composer
      session={session}
      draft="First line"
      isWorking={false}
      onActivate={() => {}}
      onDraftChange={(draft) => drafts.push(draft)}
      submitMessage={async (submission) => {
        submissions.push(submission)
        return { status: 'accepted', delivery: 'prompt' }
      }}
    />
  )
  const editor = view.getByRole('textbox')

  await user.click(editor)
  await user.keyboard('{Shift>}{Enter}{/Shift}')

  assert.deepEqual(submissions, [])
  await waitFor(() => assert.equal(drafts.at(-1), 'First line\n'))
})

test('Alt+Enter requests follow-up delivery', async () => {
  const submissions: unknown[] = []
  const user = createUser()
  const view = renderInBrowser(
    <Composer
      session={session}
      draft="Afterwards"
      isWorking
      onActivate={() => {}}
      onDraftChange={() => {}}
      submitMessage={async (submission) => {
        submissions.push(submission)
        return { status: 'accepted', delivery: 'follow-up' }
      }}
    />
  )

  await user.click(view.getByRole('textbox'))
  await user.keyboard('{Alt>}{Enter}{/Alt}')

  assert.deepEqual(submissions, [{ sessionId: session.id, text: 'Afterwards', delivery: 'follow-up' }])
})

test('Ctrl+Enter and Command+Enter do not submit', async () => {
  const submissions: unknown[] = []
  const user = createUser()
  const view = renderInBrowser(
    <Composer
      session={session}
      draft="No extra shortcut"
      isWorking={false}
      onActivate={() => {}}
      onDraftChange={() => {}}
      submitMessage={async (submission) => {
        submissions.push(submission)
        return { status: 'accepted', delivery: 'prompt' }
      }}
    />
  )

  await user.click(view.getByRole('textbox'))
  await user.keyboard('{Control>}{Enter}{/Control}{Meta>}{Enter}{/Meta}')

  assert.deepEqual(submissions, [])
})

test('Tab follows normal focus navigation without submitting', async () => {
  const submissions: unknown[] = []
  const user = createUser()
  const view = renderInBrowser(
    <Composer
      session={session}
      draft="Move focus"
      isWorking={false}
      onActivate={() => {}}
      onDraftChange={() => {}}
      submitMessage={async (submission) => {
        submissions.push(submission)
        return { status: 'accepted', delivery: 'prompt' }
      }}
    />
  )

  await user.click(view.getByRole('textbox'))
  await user.tab()

  assert.deepEqual(submissions, [])
  assert.equal(browser.document.activeElement?.getAttribute('aria-label'), 'Send message')
})

test('Enter during IME composition does not submit', async () => {
  const submissions: unknown[] = []
  const view = renderInBrowser(
    <Composer
      session={session}
      draft="Composing"
      isWorking={false}
      onActivate={() => {}}
      onDraftChange={() => {}}
      submitMessage={async (submission) => {
        submissions.push(submission)
        return { status: 'accepted', delivery: 'prompt' }
      }}
    />
  )

  await act(async () => {
    fireEvent.keyDown(view.getByRole('textbox'), { key: 'Enter', code: 'Enter', keyCode: 13, isComposing: true })
  })

  assert.deepEqual(submissions, [])
})

test('whitespace-only drafts cannot be sent', async () => {
  const submissions: unknown[] = []
  const user = createUser()
  const view = renderInBrowser(
    <Composer
      session={session}
      draft={' \n  '}
      isWorking={false}
      onActivate={() => {}}
      onDraftChange={() => {}}
      submitMessage={async (submission) => {
        submissions.push(submission)
        return { status: 'accepted', delivery: 'prompt' }
      }}
    />
  )
  const button = view.getByRole('button', { name: 'Send message' })

  assert.equal((button as HTMLButtonElement).disabled, true)
  await user.click(view.getByRole('textbox'))
  await user.keyboard('{Enter}')
  assert.deepEqual(submissions, [])
})

test('a repeated Enter event cannot submit the same draft again', async () => {
  const submissions: unknown[] = []
  const view = renderInBrowser(
    <Composer
      session={session}
      draft="Only once"
      isWorking={false}
      onActivate={() => {}}
      onDraftChange={() => {}}
      submitMessage={async (submission) => {
        submissions.push(submission)
        return { status: 'accepted', delivery: 'prompt' }
      }}
    />
  )

  await act(async () => {
    fireEvent.keyDown(view.getByRole('textbox'), { key: 'Enter', code: 'Enter', repeat: true })
  })

  assert.deepEqual(submissions, [])
})

test('formatted paste adds only plain text and preserves line breaks', async () => {
  const drafts: string[] = []
  const clipboard = new browser.DataTransfer()
  clipboard.setData('text/html', '<strong>First</strong><br><em>second</em>')
  const view = renderInBrowser(
    <Composer
      session={session}
      draft=""
      isWorking={false}
      onActivate={() => {}}
      onDraftChange={(draft) => drafts.push(draft)}
      submitMessage={async () => ({ status: 'accepted', delivery: 'prompt' })}
    />
  )
  const editor = view.getByRole('textbox')

  editor.focus()
  await act(async () => {
    fireEvent.paste(editor, { clipboardData: clipboard })
  })

  await waitFor(() => assert.equal(drafts.at(-1), 'First\nsecond'))
  assert.equal(editor.querySelector('strong'), null)
  assert.equal(editor.querySelector('em'), null)
})

test('awaiting preflight acceptance prevents duplicate submissions', async () => {
  const submissions: unknown[] = []
  let finishSubmission: (result: { status: 'accepted'; delivery: 'prompt' }) => void = () => {}
  const pendingSubmission = new Promise<{ status: 'accepted'; delivery: 'prompt' }>((resolve) => {
    finishSubmission = resolve
  })
  const view = renderInBrowser(
    <Composer
      session={session}
      draft="Only submit once"
      isWorking={false}
      onActivate={() => {}}
      onDraftChange={() => {}}
      submitMessage={(submission) => {
        submissions.push(submission)
        return pendingSubmission
      }}
    />
  )
  const editor = view.getByRole('textbox')

  await act(async () => {
    fireEvent.keyDown(editor, { key: 'Enter', code: 'Enter' })
    fireEvent.keyDown(editor, { key: 'Enter', code: 'Enter' })
  })

  assert.equal(submissions.length, 1)
  assert.equal(editor.getAttribute('contenteditable'), 'false')

  await act(async () => finishSubmission({ status: 'accepted', delivery: 'prompt' }))
})

test('acceptance clears the draft and restores editor focus', async () => {
  const user = createUser()
  const view = renderInBrowser(
    <StatefulComposer
      initialDraft="Accepted text"
      submitMessage={async () => ({ status: 'accepted', delivery: 'prompt' })}
    />
  )
  const editor = view.getByRole('textbox')

  await user.click(view.getByRole('button', { name: 'Send message' }))

  await waitFor(() => assert.equal(editor.textContent, ''))
  await waitFor(() =>
    assert.equal(browser.document.activeElement?.getAttribute('aria-label'), 'Message for First Session')
  )
})

test('rejection restores the exact draft and exposes an accessible error', async () => {
  const user = createUser()
  const view = renderInBrowser(
    <StatefulComposer
      initialDraft="  Retry this exactly  "
      submitMessage={async () => ({ status: 'rejected', reason: 'unexpected' })}
    />
  )
  const editor = view.getByRole('textbox')

  await user.click(view.getByRole('button', { name: 'Send message' }))

  await view.findByText('Message wasn’t sent. Try again.')
  assert.equal(editor.textContent, '  Retry this exactly  ')
  await waitFor(() =>
    assert.equal(browser.document.activeElement?.getAttribute('aria-label'), 'Message for First Session')
  )
})

test('a working Agent Run can be stopped', async () => {
  const stopped: SessionId[] = []
  const user = createUser()
  const view = renderInBrowser(
    <Composer
      session={session}
      draft=""
      isWorking
      onActivate={() => {}}
      onDraftChange={() => {}}
      submitMessage={async () => ({ status: 'accepted', delivery: 'steer' })}
      stopRun={async (id) => {
        stopped.push(id)
        return { status: 'stopped' }
      }}
    />
  )

  await user.click(view.getByRole('button', { name: 'Stop run' }))

  assert.deepEqual(stopped, [session.id])
})

test('the working-state button has the steering accessible name', () => {
  const view = renderInBrowser(
    <Composer
      session={session}
      draft="Steer"
      isWorking
      onActivate={() => {}}
      onDraftChange={() => {}}
      submitMessage={async () => ({ status: 'accepted', delivery: 'steer' })}
    />
  )

  assert.ok(view.getByRole('button', { name: 'Steer session' }))
})

test('two pinned Sessions retain independent drafts and route by their owning Session', async () => {
  const secondSession: Session = { id: sessionId('session-b'), title: 'Second Session' }
  const submissions: unknown[] = []
  const user = createUser()
  Object.assign(browser, {
    piWorkspace: {
      transcript: {
        getSnapshot: async (id: SessionId) => ({ sessionId: id, revision: 0, isWorking: false, runs: [], entries: [] }),
        getWorkingStateSnapshots: async () => [],
        loadActivityDetails: async () => undefined,
        subscribe: () => () => {},
      },
    },
  })
  const view = renderInBrowser(
    <PinnedSessionArea
      sessions={[session, secondSession]}
      submitMessage={async (submission) => {
        submissions.push(submission)
        return { status: 'accepted', delivery: 'prompt' }
      }}
    />
  )

  await user.click(view.getByRole('textbox', { name: 'Message for Second Session' }))
  await user.keyboard('{Enter}')

  assert.deepEqual(submissions, [{ sessionId: secondSession.id, text: 'Second draft', delivery: 'steer' }])
  assert.equal(view.getByRole('textbox', { name: 'Message for First Session' }).textContent, 'First draft')
})
