import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { cleanup, render, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { sessionId } from '@/src/domain/session'
import type { PiWorkspaceBridge } from '@/src/pi-workspace'
import { browser } from '@/src/renderer/test-dom'
import { SessionChanges } from './session-changes'

const id = sessionId('session-changes')

afterEach(() => cleanup())

function installBridge() {
  const diffRequests: string[] = []
  const bridge = {
    sessionChanges: {
      async getSnapshot() {
        return {
          sessionId: id,
          repositories: [
            {
              repositoryId: 'repository-a',
              repositoryName: 'Repository A',
              branch: { head: 'main', ahead: 1, behind: 0, detached: false, unborn: false },
              files: [
                {
                  path: 'src/file.ts',
                  status: 'modified' as const,
                  staged: true,
                  unstaged: true,
                  additions: 1,
                  deletions: 1,
                },
              ],
            },
          ],
        }
      },
      async loadFileDiff(_sessionId: string, _repositoryId: string, _path: string, view: string) {
        diffRequests.push(view)
        return { status: 'available' as const, content: '@@ -1 +1 @@\n-old\n+new', truncated: false }
      },
    },
    transcript: {
      subscribe() {
        return () => {}
      },
    },
  } as unknown as PiWorkspaceBridge

  Object.defineProperty(browser.window, 'piWorkspace', { configurable: true, value: bridge })
  return diffRequests
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

  browser.window.dispatchEvent(new browser.window.Event('focus'))
  await waitFor(() => assert.equal(requests.length, 2))
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
  await waitFor(() => assert.ok(view.getByText('newer.ts')))

  requests[0]!({ sessionId: id, repositories: [] })
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.ok(view.getByText('newer.ts'))
})

test('navigates from a changed file to lazy all, staged, and unstaged diffs', async () => {
  const user = userEvent.setup({ document: browser.document as unknown as Document })
  const diffRequests = installBridge()
  const view = render(<SessionChanges sessionId={id} />, {
    container: browser.document.body as unknown as HTMLElement,
  })

  await waitFor(() => assert.ok(view.getByRole('button', { name: /src\/file.ts/ })))
  await user.click(view.getByRole('button', { name: /src\/file.ts/ }))
  await waitFor(() => assert.ok(view.getByRole('region', { name: 'Diff for src/file.ts' })))

  assert.deepEqual(diffRequests, ['all'])
  await user.click(view.getByRole('tab', { name: /^staged$/i }))
  await waitFor(() => assert.deepEqual(diffRequests, ['all', 'staged']))
  await user.click(view.getByRole('tab', { name: /^unstaged$/i }))
  await waitFor(() => assert.deepEqual(diffRequests, ['all', 'staged', 'unstaged']))
  await user.click(view.getByRole('button', { name: 'Back to changed files' }))

  const fileButton = view.getByRole('button', { name: /src\/file.ts/ })
  assert.ok(view.getByText('1 changed files'))
  await waitFor(() => assert.equal(browser.document.activeElement, fileButton))
})
