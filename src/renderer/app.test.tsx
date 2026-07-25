import { browser } from '@/src/renderer/test-dom'
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { WorkspacesSnapshot } from '@/src/application-state'
import { sessionId, type SessionId } from '@/src/domain/session'
import type { Workstream, WorkstreamsSnapshot } from '@/src/domain/workstream'
import type { PiWorkspaceBridge } from '@/src/pi-workspace'
import type { SettingsUpdate } from '@/src/settings'
import { App } from './app'
import { ThemeProvider } from './theme'

const workspaces: WorkspacesSnapshot = {
  revision: 1,
  workspaces: [
    {
      id: 'workspace-a',
      name: 'Workspace A',
      repositories: [
        {
          id: 'repository-a',
          membershipId: 'membership-a',
          name: 'Repository A',
          directoryPath: '/repositories/a',
          availability: 'available',
          role: '',
          relationships: [],
          validationCommands: [],
        },
      ],
    },
    {
      id: 'workspace-b',
      name: 'Workspace B',
      repositories: [
        {
          id: 'repository-b',
          membershipId: 'membership-b',
          name: 'Repository B',
          directoryPath: '/repositories/b',
          availability: 'available',
          role: '',
          relationships: [],
          validationCommands: [],
        },
      ],
    },
  ],
}

function ownedWorkstream(workspaceId: string, workstreamId: string, goal: string, sessionName: string): Workstream {
  return {
    id: workstreamId,
    workspaceId,
    goal,
    lifecycle: 'active',
    workingLocation: 'current-checkouts',
    repositoryWorkingLocations: [],
    sessions: [
      {
        id: sessionId(`${workstreamId}-session`),
        workstreamId,
        title: sessionName,
        mode: 'implement',
        availability: 'available',
        repositoryAccess: { kind: 'managed' as const },
      },
    ],
  }
}

const workspaceAWorkstream = ownedWorkstream('workspace-a', 'workstream-a', 'Ship Workspace A', 'Session A')
const workspaceBWorkstream = ownedWorkstream('workspace-b', 'workstream-b', 'Ship Workspace B', 'Session B')

function snapshot(workstreams: readonly Workstream[], revision = 1): WorkstreamsSnapshot {
  return { revision, workstreams }
}

function deferred<Value>() {
  let resolvePromise: (value: Value) => void = () => {}
  const promise = new Promise<Value>((resolve) => {
    resolvePromise = resolve
  })

  return { promise, resolve: resolvePromise }
}

function createBridge(
  overrides: Partial<PiWorkspaceBridge['workstreams']> = {},
  applicationStateOverrides: Partial<PiWorkspaceBridge['applicationState']> = {}
): PiWorkspaceBridge {
  return {
    applicationState: {
      getStartup: async () => ({ status: 'ready' }),
      getWorkspaces: async () => workspaces,
      ...applicationStateOverrides,
    },
    composer: {
      submit: async () => ({ status: 'accepted', delivery: 'prompt' }),
    },
    transcript: {
      getSnapshot: async (id: SessionId) => ({ sessionId: id, revision: 0, isWorking: false, runs: [], entries: [] }),
      getWorkingStateSnapshots: async () => [],
      loadActivityDetails: async () => undefined,
      subscribe: () => () => {},
    },
    settings: {
      getSnapshot: async () => ({ appearance: 'system', theme: 'railyard', resolvedColorScheme: 'light' }),
      update: async (update: SettingsUpdate) => ({
        appearance: update.appearance ?? 'system',
        theme: update.theme ?? 'railyard',
        resolvedColorScheme: 'light',
      }),
      subscribe: () => () => {},
    },
    workstreamKnowledge: {
      get: async (workstreamId: string) => ({
        workstreamId,
        goal: 'Test Workstream',
        knowledgeRevision: 0,
        specificationRevision: 0,
        specificationVersion: 0,
        currentRepositoryIds: [],
        records: [],
        specificationVersions: [],
      }),
      mutate: async () => {
        throw new Error('Not implemented in this test.')
      },
      subscribe: () => () => {},
    },
    workstreams: {
      getSnapshot: async (workspaceId: string) =>
        workspaceId === 'workspace-a' ? snapshot([workspaceAWorkstream]) : snapshot([workspaceBWorkstream]),
      createWorkstream: async () => {
        throw new Error('Not implemented in this test.')
      },
      createQuickSession: async () => {
        throw new Error('Not implemented in this test.')
      },
      createSession: async () => {
        throw new Error('Not implemented in this test.')
      },
      setLifecycle: async () => {
        throw new Error('Not implemented in this test.')
      },
      renameSession: async () => {
        throw new Error('Not implemented in this test.')
      },
      ...overrides,
    },
  } as unknown as PiWorkspaceBridge
}

function renderApp(bridge: PiWorkspaceBridge) {
  Object.assign(browser, { piWorkspace: bridge })

  return render(
    <ThemeProvider>
      <App />
    </ThemeProvider>,
    { container: browser.document.body as unknown as HTMLElement }
  )
}

afterEach(cleanup)

test('updates theme immediately from global Settings', async () => {
  const updates: SettingsUpdate[] = []
  const bridge = createBridge()
  Object.assign(bridge.settings, {
    update: async (update: SettingsUpdate) => {
      updates.push(update)
      return { appearance: 'system', theme: update.theme ?? 'railyard', resolvedColorScheme: 'light' }
    },
  })
  const user = userEvent.setup({ document: browser.document as unknown as Document })
  const view = renderApp(bridge)

  await view.findByText('Ship Workspace A')
  await user.click(view.getByRole('button', { name: 'Settings' }))
  await user.click(view.getByRole('radio', { name: 'One' }))

  await waitFor(() => assert.deepEqual(updates, [{ theme: 'one' }]))
})

test('closes Settings from its close button', async () => {
  const user = userEvent.setup({ document: browser.document as unknown as Document })
  const view = renderApp(createBridge())

  await view.findByText('Ship Workspace A')
  await user.click(view.getByRole('button', { name: 'Settings' }))
  assert.ok(view.getByRole('dialog', { name: 'Settings' }))

  await user.click(view.getByRole('button', { name: 'Close settings' }))
  await waitFor(() => assert.equal(view.queryByRole('dialog', { name: 'Settings' }), null))
})

test('opens the Changelog from the footer release notes action', async () => {
  const user = userEvent.setup({ document: browser.document as unknown as Document })
  const view = renderApp(createBridge())

  await view.findByText('Ship Workspace A')
  await user.click(view.getByRole('button', { name: /Release notes/ }))

  await view.findByRole('heading', { name: 'Changelog' })
})

test('renders a named accessible state while startup is pending', async () => {
  const startup = deferred<Awaited<ReturnType<PiWorkspaceBridge['applicationState']['getStartup']>>>()
  const view = renderApp(createBridge({}, { getStartup: () => startup.promise }))

  assert.equal((await view.findByRole('status')).textContent, 'Starting Railyard')
})

test('renders a named accessible state while Workspaces are loading', async () => {
  const workspaceLoad = deferred<WorkspacesSnapshot>()
  const view = renderApp(createBridge({}, { getWorkspaces: () => workspaceLoad.promise }))

  await waitFor(() => assert.equal(view.getByRole('status').textContent, 'Loading Workspaces'))
})

test('renders a named accessible error when startup fails', async () => {
  const view = renderApp(
    createBridge(
      {},
      {
        getStartup: async () => {
          throw new Error('Startup authority failed.')
        },
      }
    )
  )

  assert.match((await view.findByRole('alert')).textContent ?? '', /Could not start Railyard.*Startup authority failed/)
})

test('retries startup without reloading the renderer', async () => {
  let attempts = 0
  const user = userEvent.setup({ document: browser.document as unknown as Document })
  const view = renderApp(
    createBridge(
      {},
      {
        getStartup: async () => {
          attempts += 1
          if (attempts === 1) throw new Error('Startup authority failed.')

          return { status: 'ready' }
        },
      }
    )
  )

  await user.click(await view.findByRole('button', { name: 'Try again' }))

  await view.findByText('Ship Workspace A')
  assert.equal(attempts, 2)
})

test('renders a named accessible error when Workspaces fail to load', async () => {
  const view = renderApp(
    createBridge(
      {},
      {
        getWorkspaces: async () => {
          throw new Error('Workspace authority failed.')
        },
      }
    )
  )

  assert.match(
    (await view.findByRole('alert')).textContent ?? '',
    /Could not load Workspaces.*Workspace authority failed/
  )
})

test('retries loading Workspaces without repeating startup', async () => {
  let startupAttempts = 0
  let workspaceAttempts = 0
  const user = userEvent.setup({ document: browser.document as unknown as Document })
  const view = renderApp(
    createBridge(
      {},
      {
        getStartup: async () => {
          startupAttempts += 1
          return { status: 'ready' }
        },
        getWorkspaces: async () => {
          workspaceAttempts += 1
          if (workspaceAttempts === 1) throw new Error('Workspace authority failed.')

          return workspaces
        },
      }
    )
  )

  await user.click(await view.findByRole('button', { name: 'Try again' }))

  await view.findByText('Ship Workspace A')
  assert.equal(startupAttempts, 1)
  assert.equal(workspaceAttempts, 2)
})

test('retries Workstreams only for the selected Workspace', async () => {
  let attempts = 0
  const user = userEvent.setup({ document: browser.document as unknown as Document })
  const view = renderApp(
    createBridge({
      getSnapshot: async () => {
        attempts += 1
        if (attempts === 1) throw new Error('Workstream authority failed.')

        return snapshot([workspaceAWorkstream])
      },
    })
  )

  await user.click(await view.findByRole('button', { name: 'Try again' }))

  await view.findByText('Ship Workspace A')
  assert.equal(attempts, 2)
})

test('selects and reveals a newly created Session from the returned snapshot', async () => {
  const newSessionId = sessionId('new-session')
  const updatedWorkstream: Workstream = {
    ...workspaceAWorkstream,
    sessions: [
      ...workspaceAWorkstream.sessions,
      {
        id: newSessionId,
        workstreamId: workspaceAWorkstream.id,
        title: 'New Session',
        mode: 'brainstorm',
        availability: 'available',
        repositoryAccess: { kind: 'managed' as const },
      },
    ],
  }
  const user = userEvent.setup({ document: browser.document as unknown as Document })
  const view = renderApp(
    createBridge({
      createSession: async () => ({
        status: 'available',
        sessionId: newSessionId,
        snapshot: snapshot([updatedWorkstream], 2),
      }),
    })
  )

  await view.findByText('Ship Workspace A')
  await user.click(view.getByRole('button', { name: 'New Session in Ship Workspace A' }))
  await user.click(view.getByRole('button', { name: 'Create Session' }))

  await waitFor(() => assert.ok(view.getByRole('heading', { name: 'New Session' })))
  await waitFor(() =>
    assert.equal(browser.document.activeElement?.getAttribute('aria-label'), 'Message for New Session')
  )
})

test('reveals a forked Session with the selected message restored as its draft', async () => {
  const forkedSessionId = sessionId('forked-session')
  const updatedWorkstream: Workstream = {
    ...workspaceAWorkstream,
    sessions: [
      ...workspaceAWorkstream.sessions,
      {
        ...workspaceAWorkstream.sessions[0]!,
        id: forkedSessionId,
        title: 'Fork of Session A',
      },
    ],
  }
  const bridge = createBridge({
    getSessionForkPoints: async () => [{ entryId: 'aaaa0001', text: 'Try another approach', position: 1, total: 1 }],
    forkSession: async () => ({
      status: 'available',
      sessionId: forkedSessionId,
      snapshot: snapshot([updatedWorkstream], 2),
      draft: 'Try another approach',
    }),
  })
  const user = userEvent.setup({ document: browser.document as unknown as Document })
  const view = renderApp(bridge)

  await view.findByText('Ship Workspace A')
  await user.click(view.getByRole('button', { name: 'Session A Implement' }))
  await view.findByRole('heading', { name: 'Session A' })
  await user.click(view.getByRole('button', { name: 'Session A options' }))
  await user.click(await view.findByRole('menuitem', { name: 'Fork Session…' }))
  await view.findByText('Try another approach', { exact: true })
  await user.click(view.getByRole('button', { name: 'Fork Session' }))

  await waitFor(() => assert.ok(view.getByRole('heading', { name: 'Fork of Session A' })))
  const composer = view.getByLabelText('Message for Fork of Session A')
  await waitFor(() => assert.equal(composer.textContent, 'Try another approach'))
})

test('ignores an older mutation response within the selected Workspace', async () => {
  const lifecycleUpdate = deferred<WorkstreamsSnapshot>()
  const newSessionId = sessionId('newer-session')
  const updatedWorkstream: Workstream = {
    ...workspaceAWorkstream,
    sessions: [
      ...workspaceAWorkstream.sessions,
      {
        id: newSessionId,
        workstreamId: workspaceAWorkstream.id,
        title: 'Newer Session',
        mode: 'implement',
        availability: 'available',
        repositoryAccess: { kind: 'managed' as const },
      },
    ],
  }
  const user = userEvent.setup({ document: browser.document as unknown as Document })
  const view = renderApp(
    createBridge({
      createSession: async () => ({
        status: 'available',
        sessionId: newSessionId,
        snapshot: snapshot([updatedWorkstream], 3),
      }),
      setLifecycle: () => lifecycleUpdate.promise,
    })
  )

  await view.findByText('Ship Workspace A')
  await user.click(view.getByRole('button', { name: 'Ship Workspace A options' }))
  await user.click(await view.findByRole('menuitem', { name: 'Archive Workstream' }))
  await user.click(view.getByRole('button', { name: 'New Session in Ship Workspace A' }))
  await user.click(view.getByRole('button', { name: 'Create Session' }))
  await view.findByRole('heading', { name: 'Newer Session' })

  await act(async () => {
    lifecycleUpdate.resolve(snapshot([{ ...workspaceAWorkstream, lifecycle: 'archived' }], 2))
    await lifecycleUpdate.promise
  })

  assert.ok(view.getByRole('heading', { name: 'Newer Session' }))
})

test('ignores a Workstream mutation response after switching away and back', async () => {
  const lifecycleUpdate = deferred<WorkstreamsSnapshot>()
  const user = userEvent.setup({ document: browser.document as unknown as Document })
  const view = renderApp(
    createBridge({
      setLifecycle: () => lifecycleUpdate.promise,
    })
  )

  await view.findByText('Ship Workspace A')
  await user.click(view.getByRole('button', { name: 'Ship Workspace A options' }))
  await user.click(await view.findByRole('menuitem', { name: 'Archive Workstream' }))
  await user.click(view.getByRole('button', { name: 'Switch Workspace' }))
  await user.click(await view.findByRole('menuitem', { name: /Workspace B/ }))
  await view.findByText('Ship Workspace B')
  await user.click(view.getByRole('button', { name: 'Switch Workspace' }))
  await user.click(await view.findByRole('menuitem', { name: /Workspace A/ }))
  await view.findByText('Ship Workspace A')

  await act(async () => {
    lifecycleUpdate.resolve(snapshot([{ ...workspaceAWorkstream, lifecycle: 'archived' }], 2))
    await lifecycleUpdate.promise
  })

  assert.ok(view.getByText('Ship Workspace A'))
  assert.equal(view.queryByText('Archived'), null)
})
