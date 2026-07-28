import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { act, cleanup, render, waitFor } from '@testing-library/react'
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
    async getBranches() {
      throw new Error('Not used.')
    },
    async switchBranch() {
      throw new Error('Not used.')
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

test('loads cached branches before lazily refreshing remote branches', async () => {
  const requests: boolean[] = []
  let finishRefresh: () => void = () => {}
  const refreshReady = new Promise<void>((resolve) => {
    finishRefresh = resolve
  })
  const bridge: SessionWorkingLocationsBridge = {
    async get() {
      return currentSnapshot
    },
    async getBranches(sessionId, repositoryId, options) {
      requests.push(options?.refresh ?? false)
      if (options?.refresh) await refreshReady

      return {
        sessionId,
        repositoryId,
        branches: [
          { ref: 'refs/heads/main', name: 'main', kind: 'local', current: true },
          { ref: 'refs/heads/feature/local', name: 'feature/local', kind: 'local', current: false },
          ...(options?.refresh
            ? [
                {
                  ref: 'refs/remotes/origin/feature/remote',
                  name: 'origin/feature/remote',
                  kind: 'remote' as const,
                  current: false,
                },
              ]
            : []),
        ],
      }
    },
    async switchBranch() {
      throw new Error('Not used.')
    },
    async createWorktree() {
      throw new Error('Not used.')
    },
  }
  const user = userEvent.setup({ document: browser.document as unknown as Document })
  const view = render(
    <SessionWorkingLocationControls
      bridge={bridge}
      canCreateWorktree={false}
      canSwitchBranch
      isWorking={false}
      sessionId={currentSnapshot.sessionId}
    />,
    { container: browser.document.body as unknown as HTMLElement }
  )

  await user.click(await view.findByRole('button', { name: 'Current checkout · main' }))

  assert.ok(await view.findByRole('button', { name: 'feature/local' }))
  await waitFor(() => assert.deepEqual(requests, [false, true]))
  assert.ok(view.getByText('Refreshing remote branches…'))

  finishRefresh()

  assert.ok(await view.findByRole('button', { name: 'origin/feature/remote' }))
})

test('confirms a shared current-checkout branch switch', async () => {
  const switches: string[] = []
  const bridge: SessionWorkingLocationsBridge = {
    async get() {
      return currentSnapshot
    },
    async getBranches(sessionId, repositoryId) {
      return {
        sessionId,
        repositoryId,
        branches: [
          { ref: 'refs/heads/main', name: 'main', kind: 'local', current: true },
          { ref: 'refs/heads/feature/local', name: 'feature/local', kind: 'local', current: false },
        ],
      }
    },
    async switchBranch(_sessionId, _repositoryId, branchRef) {
      switches.push(branchRef)
      return {
        ...currentSnapshot,
        repositories: [{ ...currentSnapshot.repositories[0]!, branch: 'feature/local' }],
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
      canCreateWorktree={false}
      canSwitchBranch
      isWorking={false}
      sessionId={currentSnapshot.sessionId}
    />,
    { container: browser.document.body as unknown as HTMLElement }
  )

  await user.click(await view.findByRole('button', { name: 'Current checkout · main' }))
  await user.click(await view.findByRole('button', { name: 'feature/local' }))

  assert.ok(view.getByRole('heading', { name: 'Switch shared checkout?' }))
  assert.deepEqual(switches, [])

  await user.click(view.getByRole('button', { name: 'Switch to feature/local' }))

  await waitFor(() => assert.deepEqual(switches, ['refs/heads/feature/local']))
  assert.ok(await view.findByRole('button', { name: 'Current checkout · feature/local' }))
})

test('refreshes shared checkout context after another Session switches branches', async () => {
  let snapshot = currentSnapshot
  let publishChange: () => void = () => {}
  const bridge: SessionWorkingLocationsBridge = {
    async get() {
      return snapshot
    },
    async getBranches() {
      throw new Error('Not used.')
    },
    async switchBranch() {
      throw new Error('Not used.')
    },
    async createWorktree() {
      throw new Error('Not used.')
    },
    subscribe(listener) {
      publishChange = listener
      return () => {}
    },
  }
  const view = render(
    <SessionWorkingLocationControls
      bridge={bridge}
      canCreateWorktree={false}
      isWorking={false}
      sessionId={currentSnapshot.sessionId}
    />,
    { container: browser.document.body as unknown as HTMLElement }
  )

  assert.ok(await view.findByText('Current checkout · main'))

  snapshot = {
    ...currentSnapshot,
    repositories: [{ ...currentSnapshot.repositories[0]!, branch: 'feature/shared' }],
  }
  act(() => publishChange())

  assert.ok(await view.findByText('Current checkout · feature/shared'))
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
    async getBranches() {
      throw new Error('Not used.')
    },
    async switchBranch() {
      throw new Error('Not used.')
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
