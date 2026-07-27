import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { cleanup, render, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { sessionId } from '@/src/domain/session'
import type { SessionWorkingLocationsBridge } from '@/src/session-working-locations'
import { browser } from '@/src/renderer/test-dom'
import { SessionWorkingLocationControls } from './session-working-location-controls'

const currentSnapshot = {
  sessionId: sessionId('session-a'),
  repositories: [
    {
      repositoryId: 'repository-a',
      repositoryName: 'Repository A',
      kind: 'current-checkout' as const,
      availability: 'available' as const,
      branch: 'main',
      workingPath: '/workspace/repository-a',
    },
  ],
}

afterEach(cleanup)

test('creates a worktree only after the user requests isolation for the selected Repository', async () => {
  const requests: string[][] = []
  const copiedPaths: string[] = []
  const bridge: SessionWorkingLocationsBridge = {
    async get() {
      return currentSnapshot
    },
    async createWorktree(...values) {
      requests.push(values)
      return {
        ...currentSnapshot,
        repositories: [
          {
            ...currentSnapshot.repositories[0]!,
            kind: 'worktree',
            branch: 'railyard/session-a/repository-a',
            workingPath: '/workspace/.worktrees/session-a/repository-a',
          },
        ],
      }
    },
  }
  const user = userEvent.setup({ document: browser.document as unknown as Document })
  Object.defineProperty(browser.navigator, 'clipboard', {
    configurable: true,
    value: {
      async writeText(path: string) {
        copiedPaths.push(path)
      },
    },
  })
  const view = render(
    <SessionWorkingLocationControls
      bridge={bridge}
      canCreateWorktree
      isWorking={false}
      sessionId={currentSnapshot.sessionId}
    />,
    { container: browser.document.body as unknown as HTMLElement }
  )

  assert.ok(await view.findByText('Repository A'))
  assert.ok(view.getByRole('button', { name: 'Current checkout · main' }))
  assert.deepEqual(requests, [])

  await user.click(view.getByRole('button', { name: 'Current checkout · main' }))
  await user.click(view.getByRole('menuitem', { name: 'Create worktree' }))

  const worktree = await view.findByRole('button', { name: 'Copy worktree path' })
  assert.equal(worktree.title, '.worktrees/session-a/repository-a')
  assert.equal(worktree.textContent, 'Worktree')
  assert.equal(view.queryByText('/workspace/.worktrees/session-a/repository-a'), null)
  await user.hover(worktree)
  assert.equal(worktree.textContent, 'Worktree')
  await user.click(worktree)
  await waitFor(() => assert.deepEqual(copiedPaths, ['/workspace/.worktrees/session-a/repository-a']))
  await waitFor(() => assert.equal(view.queryByRole('menuitem'), null))
  assert.deepEqual(requests, [[currentSnapshot.sessionId, 'repository-a']])
})

test('selects which Workstream Repository context to show', async () => {
  const bridge: SessionWorkingLocationsBridge = {
    async get() {
      return {
        sessionId: currentSnapshot.sessionId,
        repositories: [
          ...currentSnapshot.repositories,
          {
            repositoryId: 'repository-b',
            repositoryName: 'Repository B',
            kind: 'current-checkout' as const,
            availability: 'available' as const,
            branch: 'develop',
            workingPath: '/workspace/repository-b',
          },
        ],
      }
    },
    async createWorktree() {
      throw new Error('Not used.')
    },
  }
  const user = userEvent.setup({ document: browser.document as unknown as Document })
  const view = render(
    <SessionWorkingLocationControls
      bridge={bridge}
      canCreateWorktree
      isWorking={false}
      sessionId={currentSnapshot.sessionId}
    />,
    { container: browser.document.body as unknown as HTMLElement }
  )

  const repository = await view.findByRole('button', { name: 'Repository' })
  await user.click(repository)
  await user.click(view.getByRole('menuitem', { name: 'Repository B' }))

  assert.ok(view.getByRole('button', { name: 'Current checkout · develop' }))
  await waitFor(() => assert.equal(view.queryByRole('menuitem'), null))
})
