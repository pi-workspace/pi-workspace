import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { sessionId } from '@/src/domain/session'
import type { PiWorkspaceBridge } from '@/src/pi-workspace'
import { browser } from '@/src/renderer/test-dom'
import { SessionChanges } from './session-changes'

const id = sessionId('session-changes')

afterEach(() => cleanup())

function installBridge({
  deferRefreshedDiff = false,
  diffContent = '@@ -1 +1 @@\n-old\n+new',
  includeChangedFile = true,
  initialReviewComments = [],
}: Readonly<{
  deferRefreshedDiff?: boolean
  diffContent?: string
  includeChangedFile?: boolean
  initialReviewComments?: readonly import('@/src/session-code-review').SessionCodeReviewComment[]
}> = {}) {
  const diffRequests: string[] = []
  const stageRequests: boolean[] = []
  const savedReviewComments: string[] = []
  const submittedReviews: unknown[] = []
  let finishedReviews = 0
  let reviewComments = [...initialReviewComments]
  let resolveRefreshedDiff: (() => void) | undefined
  const refreshedDiff = new Promise<void>((resolve) => {
    resolveRefreshedDiff = resolve
  })
  let staged = true
  let unstaged = true
  const snapshot = () => ({
    sessionId: id,
    repositories: [
      {
        repositoryId: 'repository-a',
        repositoryName: 'Repository A',
        branch: { head: 'main', ahead: 1, behind: 0, detached: false, unborn: false },
        files: includeChangedFile
          ? [
              {
                path: 'src/file.ts',
                status: 'modified' as const,
                staged,
                unstaged,
                additions: 1,
                deletions: 1,
              },
            ]
          : [],
      },
    ],
  })
  const bridge = {
    sessionChanges: {
      async getSnapshot() {
        return snapshot()
      },
      async loadFileDiff(_sessionId: string, _repositoryId: string, _path: string, view: string) {
        diffRequests.push(view)
        if (deferRefreshedDiff && diffRequests.length > 1) await refreshedDiff

        return { status: 'available' as const, content: diffContent, truncated: false }
      },
      async setFileStaged(_sessionId: string, _repositoryId: string, _path: string, nextStaged: boolean) {
        stageRequests.push(nextStaged)
        staged = nextStaged
        unstaged = !nextStaged
        return snapshot()
      },
    },
    composer: {
      async getCodeReviewDraft() {
        return { comments: reviewComments }
      },
      async saveCodeReviewComment(command: import('@/src/composer').SessionCodeReviewCommentCommand) {
        savedReviewComments.push(command.text)
        const comment = {
          id: command.commentId ?? 'comment-1',
          text: command.text,
          reference: command.reference,
          createdAt: 1,
        }
        reviewComments = command.commentId
          ? reviewComments.map((candidate) => (candidate.id === command.commentId ? comment : candidate))
          : [...reviewComments, comment]
        return { comments: reviewComments }
      },
      async removeCodeReviewComment(_sessionId: string, commentId: string) {
        reviewComments = reviewComments.filter((comment) => comment.id !== commentId)
        return { comments: reviewComments }
      },
      async finishCodeReview() {
        finishedReviews += 1
        reviewComments = []
        return { status: 'accepted' as const, delivery: 'prompt' as const }
      },
      async submit(submission: unknown) {
        submittedReviews.push(submission)
        return { status: 'accepted' as const, delivery: 'follow-up' as const }
      },
    },
    sessionSkills: {
      async getAvailable() {
        return [{ name: 'tdd', description: 'Test-driven development.' }]
      },
    },
    transcript: {
      subscribe() {
        return () => {}
      },
    },
  } as unknown as PiWorkspaceBridge

  Object.defineProperty(browser.window, 'piWorkspace', { configurable: true, value: bridge })
  return {
    diffRequests,
    stageRequests,
    savedReviewComments,
    submittedReviews,
    get finishedReviews() {
      return finishedReviews
    },
    resolveRefreshedDiff,
  }
}

test('discards a stale changes refresh response', async () => {
  const requests: Array<(snapshot: Awaited<ReturnType<PiWorkspaceBridge['sessionChanges']['getSnapshot']>>) => void> =
    []
  Object.defineProperty(browser.window, 'piWorkspace', {
    configurable: true,
    value: {
      sessionChanges: {
        getSnapshot: () =>
          new Promise((resolve) => {
            requests.push(resolve)
          }),
      },
      transcript: { subscribe: () => () => {} },
    } as unknown as PiWorkspaceBridge,
  })
  const view = render(<SessionChanges sessionId={id} />, {
    container: browser.document.body as unknown as HTMLElement,
  })
  await waitFor(() => assert.equal(requests.length, 1))

  act(() => browser.window.dispatchEvent(new browser.window.Event('focus')))
  await waitFor(() => assert.equal(requests.length, 2))
  await act(async () => {
    requests[1]!({
      sessionId: id,
      repositories: [
        {
          repositoryId: 'repository-a',
          repositoryName: 'Repository A',
          branch: { head: 'main', ahead: 0, behind: 0, detached: false, unborn: false },
          files: [{ path: 'newer.ts', status: 'added', staged: false, unstaged: true }],
        },
      ],
    })
    await Promise.resolve()
  })
  await waitFor(() => assert.ok(view.getByText('newer.ts')))

  await act(async () => {
    requests[0]!({ sessionId: id, repositories: [] })
    await Promise.resolve()
  })
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.ok(view.getByText('newer.ts'))
})

test('toggles a lazy inline diff and stages the whole file from its indeterminate state', async () => {
  const user = userEvent.setup({ document: browser.document as unknown as Document })
  const { diffRequests, stageRequests } = installBridge()
  const view = render(<SessionChanges sessionId={id} />, {
    container: browser.document.body as unknown as HTMLElement,
  })

  const fileButton = await waitFor(() => view.getByRole('button', { name: /src\/file.ts/ }))
  const stageCheckbox = view.getByRole('checkbox', { name: 'Stage src/file.ts' })
  assert.equal(stageCheckbox.getAttribute('aria-checked'), 'mixed')

  await user.click(fileButton)
  await waitFor(() => assert.ok(view.getByRole('region', { name: 'Diff for src/file.ts' })))
  assert.deepEqual(diffRequests, ['all'])

  await user.click(stageCheckbox)
  await waitFor(() =>
    assert.equal(view.getByRole('checkbox', { name: 'Unstage src/file.ts' }).getAttribute('aria-checked'), 'true')
  )
  assert.deepEqual(stageRequests, [true])
  await waitFor(() => assert.deepEqual(diffRequests, ['all', 'all']))

  await user.click(fileButton)
  assert.equal(view.queryByRole('region', { name: 'Diff for src/file.ts' }), null)
  assert.ok(view.getByText('1 changed file'))
})

test('retains a hunk comment until the user finishes the code review', async () => {
  const user = userEvent.setup({ document: browser.document as unknown as Document })
  const review = installBridge()
  const view = render(<SessionChanges sessionId={id} />, {
    container: browser.document.body as unknown as HTMLElement,
  })

  await user.click(await waitFor(() => view.getByRole('button', { name: /src\/file.ts/ })))
  await waitFor(() => assert.ok(view.getByRole('region', { name: 'Diff for src/file.ts' })))

  await user.click(view.getByRole('button', { name: 'Comment' }))
  await user.type(view.getByRole('textbox', { name: 'Comment on src/file.ts' }), 'Keep this diff visible.{Enter}')

  await waitFor(() => assert.ok(view.getByRole('button', { name: 'Finish review (1)' })))
  assert.deepEqual(review.savedReviewComments, ['Keep this diff visible.'])
  assert.ok(view.getByText('Keep this diff visible.'))

  await user.click(view.getByRole('button', { name: 'Finish review (1)' }))
  await waitFor(() => assert.equal(review.finishedReviews, 1))
  assert.equal(view.queryByRole('button', { name: 'Finish review (1)' }), null)
})

test('keeps a persisted comment manageable after its file leaves current changes', async () => {
  const user = userEvent.setup({ document: browser.document as unknown as Document })
  const comment = {
    id: 'comment-1',
    text: 'Keep the previous behavior.',
    createdAt: 1,
    reference: {
      repositoryId: 'repository-a',
      repositoryName: 'Repository A',
      path: 'src/removed.ts',
      oldStart: 1,
      oldLines: 1,
      newStart: 1,
      newLines: 1,
      patch: '@@ -1 +1 @@\n-old\n+new',
    },
  }
  const review = installBridge({ includeChangedFile: false, initialReviewComments: [comment] })
  const view = render(<SessionChanges sessionId={id} />, {
    container: browser.document.body as unknown as HTMLElement,
  })

  assert.ok(await waitFor(() => view.getByText('Keep the previous behavior.')))
  assert.ok(view.getByText('src/removed.ts'))
  await user.click(view.getByRole('button', { name: 'Edit review comment' }))
  const editor = view.getByRole('textbox', { name: 'Edit comment on src/removed.ts' })
  await user.type(editor, ' Updated behavior.{Enter}')

  const updated = 'Keep the previous behavior. Updated behavior.'
  await waitFor(() => assert.deepEqual(review.savedReviewComments, [updated]))
  assert.ok(view.getByText(updated))
  await user.click(view.getByRole('button', { name: 'Remove review comment' }))
  await waitFor(() => assert.equal(view.queryByText(updated), null))
})

test('sends one hunk as an immediate referenced follow-up', async () => {
  const user = userEvent.setup({ document: browser.document as unknown as Document })
  const review = installBridge()
  const view = render(<SessionChanges sessionId={id} />, {
    container: browser.document.body as unknown as HTMLElement,
  })

  await user.click(await waitFor(() => view.getByRole('button', { name: /src\/file.ts/ })))
  await user.click(await waitFor(() => view.getByRole('button', { name: 'Follow up' })))
  await user.type(view.getByRole('textbox', { name: 'Follow up on src/file.ts' }), 'Change this.{Enter}')

  await waitFor(() => assert.equal(review.submittedReviews.length, 1))
  const submission = review.submittedReviews[0] as import('@/src/composer').SessionMessageSubmission
  assert.equal(submission.delivery, 'follow-up')
  assert.equal(submission.codeReview?.kind, 'follow-up')
  assert.equal(submission.codeReview?.comments[0]?.reference.patch, '@@ -1 +1 @@\n-old\n+new')
})

test('keeps an expanded diff visible while staging refreshes its content', async () => {
  const user = userEvent.setup({ document: browser.document as unknown as Document })
  const { diffRequests, resolveRefreshedDiff } = installBridge({ deferRefreshedDiff: true })
  const view = render(<SessionChanges sessionId={id} />, {
    container: browser.document.body as unknown as HTMLElement,
  })

  await user.click(await waitFor(() => view.getByRole('button', { name: /src\/file.ts/ })))
  await waitFor(() => assert.ok(view.getByRole('region', { name: 'Diff for src/file.ts' })))

  await user.click(view.getByRole('checkbox', { name: 'Stage src/file.ts' }))
  await waitFor(() => assert.deepEqual(diffRequests, ['all', 'all']))
  assert.ok(view.getByRole('region', { name: 'Diff for src/file.ts' }))

  await act(async () => resolveRefreshedDiff?.())
})

test('unstages a fully staged file from its checkbox', async () => {
  const user = userEvent.setup({ document: browser.document as unknown as Document })
  const { stageRequests } = installBridge()
  const view = render(<SessionChanges sessionId={id} />, {
    container: browser.document.body as unknown as HTMLElement,
  })

  const stageCheckbox = await waitFor(() => view.getByRole('checkbox', { name: 'Stage src/file.ts' }))
  await user.click(stageCheckbox)
  const unstageCheckbox = await waitFor(() => view.getByRole('checkbox', { name: 'Unstage src/file.ts' }))

  await user.click(unstageCheckbox)
  await waitFor(() => assert.ok(view.getByRole('checkbox', { name: 'Stage src/file.ts' })))
  assert.deepEqual(stageRequests, [true, false])
})
