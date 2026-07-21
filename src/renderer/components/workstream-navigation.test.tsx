import { browser } from '@/src/renderer/test-dom'
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { cleanup, render, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderToStaticMarkup } from 'react-dom/server'
import { sessionId } from '@/src/domain/session'
import type { WorktreeLocationsPreview } from '@/src/domain/workstream'
import { WorkstreamNavigation } from './workstream-navigation'

type WorkstreamNavigationProperties = Parameters<typeof WorkstreamNavigation>[0]

const workstreams: WorkstreamNavigationProperties['workstreams'] = [
  {
    id: 'workstream-a',
    workspaceId: 'workspace-a',
    goal: 'Ship cancellation reasons',
    lifecycle: 'active',
    workingLocation: 'current-checkouts',
    repositoryWorkingLocations: [],
    sessions: [
      {
        id: sessionId('session-a'),
        workstreamId: 'workstream-a',
        title: 'Map current contracts',
        mode: 'brainstorm',
        availability: 'available',
        repositoryAccess: { kind: 'managed' as const },
      },
    ],
  },
]

const unavailableQuickWorkstream: WorkstreamNavigationProperties['workstreams'][number] = {
  id: 'quick-workstream',
  workspaceId: 'workspace-a',
  lifecycle: 'active',
  workingLocation: 'current-checkouts',
  repositoryWorkingLocations: [],
  sessions: [
    {
      id: sessionId('quick-session'),
      workstreamId: 'quick-workstream',
      title: 'Quick Session',
      mode: 'default',
      availability: 'unavailable',
      repositoryAccess: {
        kind: 'direct',
        repositoryId: 'repository-a',
        repositoryName: 'Repository A',
        availability: 'available',
      },
    },
  ],
}

const unavailableManagedWorkstream: WorkstreamNavigationProperties['workstreams'][number] = {
  ...workstreams[0]!,
  sessions: [{ ...workstreams[0]!.sessions[0]!, availability: 'unavailable' }],
}

const repositories: WorkstreamNavigationProperties['repositories'] = [
  {
    availability: 'available',
    directoryPath: '/repositories/a',
    id: 'repository-a',
    membershipId: 'membership-a',
    name: 'Repository A',
    relationships: [],
    role: '',
    validationCommands: [],
  },
]

function createNavigation(properties: Partial<WorkstreamNavigationProperties> = {}) {
  return (
    <WorkstreamNavigation
      activeSessionId={sessionId('session-a')}
      pinnedSessionIds={[]}
      repositories={repositories}
      workingSessionIds={new Set()}
      workstreams={workstreams}
      onActivateSession={() => {}}
      onCreateQuickSession={async () => {}}
      onCreateSession={async () => {}}
      onPreviewWorktreeLocations={async () => ({ workstreamId: 'workstream-preview', repositories: [] })}
      onCreateWorkstream={async () => {}}
      onSetWorkstreamLifecycle={async () => {}}
      onSelectWorkstream={() => {}}
      onToggleSessionPin={() => {}}
      {...properties}
    />
  )
}

function renderInBrowser(properties: Partial<WorkstreamNavigationProperties> = {}) {
  return render(createNavigation(properties), { container: browser.document.body as unknown as HTMLElement })
}

function createUser() {
  return userEvent.setup({ document: browser.document as unknown as Document })
}

async function openNewWorkstreamDialog(view: ReturnType<typeof renderInBrowser>, user: ReturnType<typeof createUser>) {
  await user.click(view.getByRole('button', { name: 'Create a Workstream' }))
}

afterEach(cleanup)

test('announces Workstreams while the selected Workspace is loading', () => {
  const markup = renderToStaticMarkup(createNavigation({ loading: true }))

  assert.match(markup, /role="status"/)
  assert.match(markup, /Loading Workstreams/)
  assert.doesNotMatch(markup, /No Workstreams yet/)
})

test('announces a Workstream loading failure instead of showing an empty state', () => {
  const markup = renderToStaticMarkup(createNavigation({ loadError: 'Application authority is unavailable.' }))

  assert.match(markup, /role="alert"/)
  assert.match(markup, /Could not load Workstreams/)
  assert.doesNotMatch(markup, /No Workstreams yet/)
})

test('keeps an unavailable Workstream visible without exposing aggregate actions', () => {
  const markup = renderToStaticMarkup(
    createNavigation({
      workstreams: [
        {
          ...workstreams[0]!,
          lifecycle: 'archived',
          sessions: [],
          unavailability: 'The persisted Workstream lifecycle is malformed.',
        },
      ],
    })
  )

  assert.match(markup, /Ship cancellation reasons/)
  assert.match(markup, /Unavailable/)
  assert.match(markup, /The persisted Workstream lifecycle is malformed/)
  assert.doesNotMatch(markup, /Restore Workstream/)
  assert.doesNotMatch(markup, /New Session in Ship cancellation reasons/)
})

test('hides archived Workstreams and Quick Sessions from navigation', () => {
  const markup = renderToStaticMarkup(
    createNavigation({
      workstreams: [
        ...workstreams,
        {
          ...workstreams[0]!,
          id: 'archived-workstream',
          goal: 'Archived Workstream',
          lifecycle: 'archived',
          sessions: [
            {
              ...workstreams[0]!.sessions[0]!,
              id: sessionId('archived-session'),
              workstreamId: 'archived-workstream',
              title: 'Archived Session',
            },
          ],
        },
      ],
    })
  )

  assert.doesNotMatch(markup, /Archived Session/)
  assert.doesNotMatch(markup, /Archived Workstream/)
})

test('shows Workstream-owned Sessions with their mode', () => {
  const markup = renderToStaticMarkup(createNavigation())

  assert.match(markup, /Ship cancellation reasons/)
  assert.match(markup, /Map current contracts/)
  assert.match(markup, />Brainstorm</)
  assert.match(markup, /aria-label="New Session in Ship cancellation reasons"/)
  assert.doesNotMatch(markup, /aria-label="Awaiting Repository scope"/)
})

test('replaces a working Brainstorm Session mode icon with an accessible spinner', () => {
  const markup = renderToStaticMarkup(createNavigation({ workingSessionIds: new Set([sessionId('session-a')]) }))

  assert.match(markup, /data-slot="session-working-icon"/)
  assert.match(markup, /Pi is working/)
  assert.match(markup, /motion-reduce:animate-none/)
  assert.doesNotMatch(markup, /aria-live/)
})

test('replaces a working Implement Session mode icon with a spinner', () => {
  const implementSession = {
    id: sessionId('session-b'),
    workstreamId: 'workstream-a',
    title: 'Implement the change',
    mode: 'implement' as const,
    availability: 'available' as const,
    repositoryAccess: { kind: 'managed' as const },
  }
  const markup = renderToStaticMarkup(
    createNavigation({
      activeSessionId: implementSession.id,
      workingSessionIds: new Set([implementSession.id]),
      workstreams: [{ ...workstreams[0]!, sessions: [implementSession] }],
    })
  )

  assert.match(markup, /data-slot="session-working-icon"/)
  assert.match(markup, /Pi is working/)
})

test('keeps working state independent from Workstream selection', () => {
  const markup = renderToStaticMarkup(
    createNavigation({ selectedWorkstreamId: 'workstream-a', workingSessionIds: new Set([sessionId('session-a')]) })
  )

  assert.match(markup, /aria-current="true"/)
  assert.match(markup, /Pi is working/)
})

test('quietly identifies a Workstream that uses separate worktrees', () => {
  const markup = renderToStaticMarkup(
    createNavigation({ workstreams: [{ ...workstreams[0]!, workingLocation: 'worktrees' }] })
  )

  assert.match(markup, /Uses separate worktrees/)
})

test('replaces a working Quick Session mode icon with a spinner', () => {
  const quickWorkstream = {
    ...unavailableQuickWorkstream,
    sessions: [{ ...unavailableQuickWorkstream.sessions[0]!, availability: 'available' as const }],
  }
  const markup = renderToStaticMarkup(
    createNavigation({
      activeSessionId: sessionId('quick-session'),
      workingSessionIds: new Set([sessionId('quick-session')]),
      workstreams: [quickWorkstream],
    })
  )

  assert.match(markup, /data-slot="session-working-icon"/)
  assert.match(markup, /Pi is working/)
})

test('quietly identifies a Quick Session that uses a worktree', () => {
  const markup = renderToStaticMarkup(
    createNavigation({
      workstreams: [
        {
          id: 'quick-workstream',
          workspaceId: 'workspace-a',
          lifecycle: 'active',
          workingLocation: 'worktrees',
          repositoryWorkingLocations: [],
          sessions: [
            {
              id: sessionId('quick-session'),
              workstreamId: 'quick-workstream',
              title: 'Quick Session',
              mode: 'default',
              availability: 'available',
              repositoryAccess: {
                kind: 'direct',
                repositoryId: 'repository-a',
                repositoryName: 'Repository A',
                availability: 'available',
              },
            },
          ],
        },
      ],
    })
  )

  assert.match(markup, /Repository A/)
  assert.match(markup, /Uses a separate worktree/)
  assert.doesNotMatch(markup, /Default · Repository A/)
})

test('selects a goal-based Workstream from its heading', async () => {
  const selections: string[] = []
  const user = createUser()
  const view = renderInBrowser({
    onSelectWorkstream: (workstreamId) => selections.push(workstreamId),
  })

  await user.click(view.getByRole('button', { name: 'Ship cancellation reasons' }))

  assert.deepEqual(selections, ['workstream-a'])
})

test('identifies the selected Workstream accessibly', () => {
  const markup = renderToStaticMarkup(createNavigation({ selectedWorkstreamId: 'workstream-a' }))

  assert.match(markup, /aria-current="true"/)
})

test('shows Quick Sessions in their own section above Workstreams', () => {
  const markup = renderToStaticMarkup(
    createNavigation({
      activeSessionId: sessionId('quick-session-a'),
      workstreams: [
        {
          id: 'quick-workstream-a',
          workspaceId: 'workspace-a',
          lifecycle: 'active',
          workingLocation: 'current-checkouts',
          repositoryWorkingLocations: [],
          sessions: [
            {
              id: sessionId('quick-session-a'),
              workstreamId: 'quick-workstream-a',
              title: 'Quick Session A',
              mode: 'default',
              availability: 'available',
              repositoryAccess: {
                kind: 'direct',
                repositoryId: 'repository-a',
                repositoryName: 'Repository A',
                availability: 'available',
              },
            },
          ],
        },
        {
          id: 'quick-workstream-b',
          workspaceId: 'workspace-a',
          lifecycle: 'active',
          workingLocation: 'current-checkouts',
          repositoryWorkingLocations: [],
          sessions: [
            {
              id: sessionId('quick-session-b'),
              workstreamId: 'quick-workstream-b',
              title: 'Quick Session B',
              mode: 'default',
              availability: 'available',
              repositoryAccess: {
                kind: 'direct',
                repositoryId: 'repository-b',
                repositoryName: 'Repository B',
                availability: 'available',
              },
            },
          ],
        },
        workstreams[0]!,
      ],
    })
  )

  assert.equal(markup.match(/>Quick Sessions</g)?.length, 1)
  assert.equal(markup.match(/>Workstreams</g)?.length, 1)
  assert.match(markup, /Quick Session A/)
  assert.match(markup, /Quick Session B/)
  assert.match(markup, /Repository A/)
  assert.match(markup, /Repository B/)
  assert.doesNotMatch(markup, /Default · Repository/)
  assert.ok(markup.indexOf('>Quick Sessions<') < markup.indexOf('>Workstreams<'))
  assert.ok(markup.indexOf('>Workstreams<') < markup.indexOf('Ship cancellation reasons'))
  assert.doesNotMatch(markup, /New Session in Quick Sessions/)
})

test('collapses Quick Sessions from its header', async () => {
  const user = createUser()
  const view = renderInBrowser({ workstreams: [unavailableQuickWorkstream] })
  const header = view.getByRole('button', { name: 'Quick Sessions' })

  await user.click(header)

  assert.equal(view.queryByRole('button', { name: /Quick Session Repository A/ }), null)
  assert.equal(header.getAttribute('aria-expanded'), 'false')
})

test('collapses Workstreams from its header', async () => {
  const user = createUser()
  const view = renderInBrowser()
  const header = view.getByRole('button', { name: 'Workstreams' })

  await user.click(header)

  assert.equal(view.queryByRole('button', { name: /Map current contracts/ }), null)
  assert.equal(header.getAttribute('aria-expanded'), 'false')
})

test('reports the working count on a collapsed Workstream', () => {
  const quickWorkstream = {
    ...unavailableQuickWorkstream,
    sessions: [{ ...unavailableQuickWorkstream.sessions[0]!, availability: 'available' as const }],
  }
  const markup = renderToStaticMarkup(
    createNavigation({
      activeSessionId: sessionId('quick-session'),
      workingSessionIds: new Set([sessionId('session-a')]),
      workstreams: [quickWorkstream, workstreams[0]!],
    })
  )

  assert.match(markup, /aria-label="1 working Session"/)
})

test('keeps Repository context visible when a Quick Session is unavailable', () => {
  const markup = renderToStaticMarkup(
    createNavigation({
      activeSessionId: sessionId('quick-session'),
      workstreams: [unavailableQuickWorkstream],
    })
  )

  assert.match(markup, /Quick Sessions/)
  assert.match(markup, /Repository A · Session history unavailable/)
  assert.doesNotMatch(markup, /Default · Repository A/)
  assert.doesNotMatch(markup, /awaiting scope/)
})

test('distinguishes an unavailable Quick Session checkout from unavailable history', () => {
  const checkoutUnavailableWorkstream = {
    ...unavailableQuickWorkstream,
    sessions: [
      {
        ...unavailableQuickWorkstream.sessions[0]!,
        mode: 'default' as const,
        availability: 'available' as const,
        repositoryAccess: {
          kind: 'direct' as const,
          repositoryId: 'repository-a',
          repositoryName: 'Repository A',
          availability: 'unavailable' as const,
        },
      },
    ],
  }
  const markup = renderToStaticMarkup(createNavigation({ workstreams: [checkoutUnavailableWorkstream] }))

  assert.match(markup, /Repository checkout unavailable/)
  assert.doesNotMatch(markup, /Session history unavailable/)
})

test('identifies both unavailable Quick Session history and checkout', () => {
  const bothUnavailableWorkstream = {
    ...unavailableQuickWorkstream,
    sessions: [
      {
        ...unavailableQuickWorkstream.sessions[0]!,
        mode: 'default' as const,
        repositoryAccess: {
          kind: 'direct' as const,
          repositoryId: 'repository-a',
          repositoryName: 'Repository A',
          availability: 'unavailable' as const,
        },
      },
    ],
  }
  const markup = renderToStaticMarkup(createNavigation({ workstreams: [bothUnavailableWorkstream] }))

  assert.match(markup, /Session history and Repository checkout unavailable/)
})

test('disables unavailable Quick Session activation', () => {
  const view = renderInBrowser({
    activeSessionId: sessionId('quick-session'),
    workstreams: [unavailableQuickWorkstream],
  })

  assert.ok((view.getByRole('button', { name: /Quick Session Repository A/ }) as HTMLButtonElement).disabled)
})

test('disables pinning an unavailable Quick Session', () => {
  const view = renderInBrowser({ workstreams: [unavailableQuickWorkstream] })

  assert.ok((view.getByRole('button', { name: 'Pin Quick Session' }) as HTMLButtonElement).disabled)
})

test('allows an unavailable pinned Quick Session to be unpinned', async () => {
  const toggledSessions: string[] = []
  const user = createUser()
  const view = renderInBrowser({
    pinnedSessionIds: [sessionId('quick-session')],
    workstreams: [unavailableQuickWorkstream],
    onToggleSessionPin: (id) => toggledSessions.push(id),
  })

  await user.click(view.getByRole('button', { name: 'Unpin Quick Session' }))

  assert.deepEqual(toggledSessions, [sessionId('quick-session')])
})

test('disables unavailable Quick Session options', () => {
  const view = renderInBrowser({ workstreams: [unavailableQuickWorkstream] })

  assert.ok((view.getByRole('button', { name: 'Quick Session in Repository A options' }) as HTMLButtonElement).disabled)
})

test('disables unavailable managed Session activation', () => {
  const view = renderInBrowser({ workstreams: [unavailableManagedWorkstream] })

  assert.ok((view.getByRole('button', { name: /Map current contracts Brainstorm/ }) as HTMLButtonElement).disabled)
})

test('disables pinning an unavailable managed Session', () => {
  const view = renderInBrowser({ workstreams: [unavailableManagedWorkstream] })

  assert.ok((view.getByRole('button', { name: 'Pin Map current contracts' }) as HTMLButtonElement).disabled)
})

test('allows an unavailable pinned Session to be unpinned', async () => {
  const toggledSessions: string[] = []
  const user = createUser()
  const view = renderInBrowser({
    pinnedSessionIds: [sessionId('session-a')],
    workstreams: [unavailableManagedWorkstream],
    onToggleSessionPin: (id) => toggledSessions.push(id),
  })
  const unpinButton = view.getByRole('button', { name: 'Unpin Map current contracts' }) as HTMLButtonElement

  assert.equal(unpinButton.disabled, false)
  await user.click(unpinButton)
  assert.deepEqual(toggledSessions, [sessionId('session-a')])
})

test('labels a goal-less Workstream lifecycle action as archiving its Quick Session', async () => {
  const updates: unknown[] = []
  const user = createUser()
  const view = renderInBrowser({
    activeSessionId: sessionId('quick-session'),
    workstreams: [
      {
        id: 'quick-workstream',
        workspaceId: 'workspace-a',
        lifecycle: 'active',
        workingLocation: 'current-checkouts',
        repositoryWorkingLocations: [],
        sessions: [
          {
            id: sessionId('quick-session'),
            workstreamId: 'quick-workstream',
            title: 'Quick Session',
            mode: 'default',
            availability: 'available',
            repositoryAccess: {
              kind: 'direct',
              repositoryId: 'repository-a',
              repositoryName: 'Repository A',
              availability: 'available',
            },
          },
        ],
      },
    ],
    onSetWorkstreamLifecycle: async (...values) => {
      updates.push(values)
    },
  })

  await user.click(view.getByRole('button', { name: 'Quick Session in Repository A options' }))
  await user.click(await view.findByRole('menuitem', { name: 'Archive Session' }))

  assert.deepEqual(updates, [['quick-workstream', 'archived']])
})

test('opens the Quick Session chooser when requested from outside the navigation', async () => {
  const view = renderInBrowser({ quickSessionCreateRequest: 1 })

  assert.ok(await view.findByRole('heading', { name: 'Start a Quick Session' }))
})

test('asks for a working location when the Workspace has one Repository', async () => {
  const creations: unknown[] = []
  const user = createUser()
  const view = renderInBrowser({
    onCreateQuickSession: async (options) => {
      creations.push(options)
    },
  })

  await user.click(view.getByRole('button', { name: 'Start a Quick Session' }))

  assert.equal(view.getByRole('radio', { name: /Current checkout/ }).getAttribute('aria-checked'), 'true')
  assert.deepEqual(creations, [])

  await user.click(view.getByRole('button', { name: 'Start Quick Session' }))

  assert.deepEqual(creations, [{ repositoryId: 'repository-a', workingLocation: 'current-checkouts' }])
})

test('previews and uses the selected Repository worktree identity for a Quick Session', async () => {
  const creations: unknown[] = []
  const previews: unknown[] = []
  const user = createUser()
  const view = renderInBrowser({
    onPreviewWorktreeLocations: async (repositoryId) => {
      previews.push(repositoryId)

      return {
        workstreamId: '00000000-0000-4000-8000-000000000097',
        repositories: [
          {
            repositoryId: 'repository-a',
            repositoryName: 'Repository A',
            workingPath: '/repositories/.worktrees/00000000-0000-4000-8000-000000000097/repository-a',
            branch: 'pi-workspace/00000000-0000-4000-8000-000000000097/repository-a',
            baseCommit: 'abc123',
          },
        ],
      }
    },
    onCreateQuickSession: async (options) => {
      creations.push(options)
    },
  })

  await user.click(view.getByRole('button', { name: 'Start a Quick Session' }))
  await user.click(view.getByRole('radio', { name: /New worktree/ }))

  await waitFor(() => assert.deepEqual(previews, ['repository-a']))
  assert.equal(view.queryByText('.worktrees/00000000-0000-4000-8000-000000000097/repository-a'), null)

  await user.click(view.getByRole('button', { name: 'Start Quick Session' }))

  assert.deepEqual(creations, [
    {
      repositoryId: 'repository-a',
      workingLocation: 'worktrees',
      workstreamId: '00000000-0000-4000-8000-000000000097',
    },
  ])
})

test('reuses a failed Quick Session worktree identity when falling back to the current checkout', async () => {
  const creations: unknown[] = []
  const user = createUser()
  const view = renderInBrowser({
    onPreviewWorktreeLocations: async () => ({
      workstreamId: '00000000-0000-4000-8000-000000000097',
      repositories: [
        {
          repositoryId: 'repository-a',
          repositoryName: 'Repository A',
          workingPath: '/repositories/.worktrees/00000000-0000-4000-8000-000000000097/repository-a',
          branch: 'pi-workspace/00000000-0000-4000-8000-000000000097/repository-a',
          baseCommit: 'abc123',
        },
      ],
    }),
    onCreateQuickSession: async (options) => {
      creations.push(options)
      if (options.workingLocation === 'worktrees') throw new Error('Git could not create the worktree.')
    },
  })

  await user.click(view.getByRole('button', { name: 'Start a Quick Session' }))
  await user.click(view.getByRole('radio', { name: /New worktree/ }))
  await waitFor(() =>
    assert.equal((view.getByRole('button', { name: 'Start Quick Session' }) as HTMLButtonElement).disabled, false)
  )
  await user.click(view.getByRole('button', { name: 'Start Quick Session' }))
  await view.findByText('Git could not create the worktree.')

  await user.click(view.getByRole('radio', { name: /Current checkout/ }))
  await user.click(view.getByRole('button', { name: 'Start Quick Session' }))

  assert.deepEqual(creations.at(-1), {
    repositoryId: 'repository-a',
    workingLocation: 'current-checkouts',
    workstreamId: '00000000-0000-4000-8000-000000000097',
  })
})

test('refreshes the Quick Session worktree preview when the selected Repository changes', async () => {
  const previews: unknown[] = []
  const user = createUser()
  const view = renderInBrowser({
    repositories: [
      ...repositories,
      { ...repositories[0]!, id: 'repository-b', membershipId: 'membership-b', name: 'Repository B' },
    ],
    onPreviewWorktreeLocations: async (repositoryId) => {
      previews.push(repositoryId)

      return {
        workstreamId: `00000000-0000-4000-8000-0000000000${repositoryId === 'repository-a' ? '97' : '98'}`,
        repositories: [],
      }
    },
  })

  await user.click(view.getByRole('button', { name: 'Start a Quick Session' }))
  await user.click(view.getByRole('radio', { name: /New worktree/ }))
  await waitFor(() => assert.deepEqual(previews, ['repository-a']))

  await user.click(view.getByRole('radio', { name: 'Repository B' }))

  await waitFor(() => assert.deepEqual(previews, ['repository-a', 'repository-b']))
})

test('previews the selected Repository after returning to Quick Session worktree mode', async () => {
  let resolveFirstPreview!: (preview: WorktreeLocationsPreview) => void
  const firstPreview = new Promise<WorktreeLocationsPreview>((resolve) => {
    resolveFirstPreview = resolve
  })
  const previews: unknown[] = []
  const user = createUser()
  const view = renderInBrowser({
    repositories: [
      ...repositories,
      { ...repositories[0]!, id: 'repository-b', membershipId: 'membership-b', name: 'Repository B' },
    ],
    onPreviewWorktreeLocations: async (repositoryId) => {
      previews.push(repositoryId)
      if (repositoryId === 'repository-a') return firstPreview

      return {
        workstreamId: '00000000-0000-4000-8000-000000000098',
        repositories: [
          {
            repositoryId: 'repository-b',
            repositoryName: 'Repository B',
            workingPath: '/repositories/.worktrees/00000000-0000-4000-8000-000000000098/repository-b',
            branch: 'pi-workspace/00000000-0000-4000-8000-000000000098/repository-b',
            baseCommit: 'def456',
          },
        ],
      }
    },
  })

  await user.click(view.getByRole('button', { name: 'Start a Quick Session' }))
  await user.click(view.getByRole('radio', { name: /New worktree/ }))
  await user.click(view.getByRole('radio', { name: /Current checkout/ }))
  await user.click(view.getByRole('radio', { name: 'Repository B' }))

  resolveFirstPreview({
    workstreamId: '00000000-0000-4000-8000-000000000097',
    repositories: [
      {
        repositoryId: 'repository-a',
        repositoryName: 'Repository A',
        workingPath: '/repositories/.worktrees/00000000-0000-4000-8000-000000000097/repository-a',
        branch: 'pi-workspace/00000000-0000-4000-8000-000000000097/repository-a',
        baseCommit: 'abc123',
      },
    ],
  })
  await waitFor(() => assert.deepEqual(previews, ['repository-a']))

  await user.click(view.getByRole('radio', { name: /New worktree/ }))

  await waitFor(() =>
    assert.equal((view.getByRole('button', { name: 'Start Quick Session' }) as HTMLButtonElement).disabled, false)
  )
  assert.equal(view.queryByText('.worktrees/00000000-0000-4000-8000-000000000098/repository-b'), null)
  assert.deepEqual(previews, ['repository-a', 'repository-b'])
})

test('selects Quick Session Repository and working-location cards', async () => {
  const previews: unknown[] = []
  const user = createUser()
  const view = renderInBrowser({
    repositories: [
      ...repositories,
      { ...repositories[0]!, id: 'repository-b', membershipId: 'membership-b', name: 'Repository B' },
    ],
    onPreviewWorktreeLocations: async (repositoryId) => {
      previews.push(repositoryId)
      return { workstreamId: 'workstream-preview', repositories: [] }
    },
  })

  await user.click(view.getByRole('button', { name: 'Start a Quick Session' }))
  await user.click(view.getByText('Repository B').closest('[data-slot="field"]')!)

  assert.equal(view.getByRole('radio', { name: 'Repository B' }).getAttribute('aria-checked'), 'true')

  await user.click(view.getByText('Create a separate ordinary Git worktree for this Quick Session.'))
  await waitFor(() => assert.deepEqual(previews, ['repository-b']))
  assert.equal(view.getByRole('radio', { name: /New worktree/ }).getAttribute('aria-checked'), 'true')

  await user.click(view.getByText('Use the selected Repository’s existing checkout.'))
  assert.equal(view.getByRole('radio', { name: /Current checkout/ }).getAttribute('aria-checked'), 'true')
})

test('asks for a Repository when a Quick Session has multiple choices', async () => {
  const creations: unknown[] = []
  const user = createUser()
  const view = renderInBrowser({
    repositories: [
      ...repositories,
      { ...repositories[0]!, id: 'repository-b', membershipId: 'membership-b', name: 'Repository B' },
    ],
    onCreateQuickSession: async (options) => {
      creations.push(options)
    },
  })

  await user.click(view.getByRole('button', { name: 'Start a Quick Session' }))
  await user.click(view.getByRole('radio', { name: 'Repository B' }))
  await user.click(view.getByRole('button', { name: 'Start Quick Session' }))

  assert.deepEqual(creations, [{ repositoryId: 'repository-b', workingLocation: 'current-checkouts' }])
})

test('shows unavailable Repositories in the Quick Session chooser without allowing selection', async () => {
  const user = createUser()
  const view = renderInBrowser({
    repositories: [
      ...repositories,
      {
        ...repositories[0]!,
        availability: 'unavailable',
        id: 'repository-b',
        membershipId: 'membership-b',
        name: 'Repository B',
      },
    ],
  })

  await user.click(view.getByRole('button', { name: 'Start a Quick Session' }))

  assert.equal(view.getByRole('radio', { name: 'Repository B' }).getAttribute('aria-disabled'), 'true')
  assert.match(view.getByText('Unavailable').textContent ?? '', /unavailable/i)
  assert.equal(view.getByText('Repository B').closest('[data-slot="field"]')?.getAttribute('title'), '/repositories/a')
})

test('creates a Workstream with Implement selected by default', async () => {
  const creations: unknown[] = []
  const user = createUser()
  const view = renderInBrowser({
    workstreams: [],
    onCreateWorkstream: async (options) => {
      creations.push(options)
    },
  })

  await openNewWorkstreamDialog(view, user)
  assert.equal(view.queryByText('Default'), null)
  await user.type(view.getByRole('textbox', { name: 'Goal' }), 'Ship cancellation reasons')
  await user.click(view.getByRole('button', { name: 'Create Workstream' }))

  assert.deepEqual(creations, [
    { goal: 'Ship cancellation reasons', mode: 'implement', workingLocation: 'current-checkouts' },
  ])
})

test('previews exact worktree paths and creates the Workstream with that identity', async () => {
  const creations: unknown[] = []
  const user = createUser()
  const view = renderInBrowser({
    workstreams: [],
    onPreviewWorktreeLocations: async () => ({
      workstreamId: 'workstream-preview',
      repositories: [
        {
          repositoryId: 'repository-a',
          repositoryName: 'Repository A',
          workingPath: '/repositories/.worktrees/workstream-preview/repository-a',
          branch: 'pi-workspace/workstream-preview/repository-a',
          baseCommit: 'abc123',
        },
      ],
    }),
    onCreateWorkstream: async (options) => {
      creations.push(options)
    },
  })

  await openNewWorkstreamDialog(view, user)
  await user.type(view.getByRole('textbox', { name: 'Goal' }), 'Work separately')
  await user.click(view.getByRole('radio', { name: /Current checkouts/ }))
  await user.keyboard('{ArrowDown}')

  await waitFor(() =>
    assert.equal((view.getByRole('button', { name: 'Create Workstream' }) as HTMLButtonElement).disabled, false)
  )
  assert.equal(view.queryByText('.worktrees/workstream-preview/repository-a'), null)
  await user.click(view.getByRole('button', { name: 'Create Workstream' }))

  assert.deepEqual(creations, [
    {
      goal: 'Work separately',
      mode: 'implement',
      workingLocation: 'worktrees',
      workstreamId: 'workstream-preview',
    },
  ])
})

test('selects Workstream working-location cards', async () => {
  const user = createUser()
  const view = renderInBrowser({ workstreams: [] })

  await openNewWorkstreamDialog(view, user)
  await user.click(view.getByText('Create a separate ordinary Git worktree for each available Repository.'))
  assert.equal(view.getByRole('radio', { name: /New worktrees/ }).getAttribute('aria-checked'), 'true')

  await user.click(view.getByText('Use each registered Repository’s existing checkout.'))
  assert.equal(view.getByRole('radio', { name: /Current checkouts/ }).getAttribute('aria-checked'), 'true')
})

test('allows an explicit Brainstorm mode when creating a Workstream', async () => {
  const creations: unknown[] = []
  const user = createUser()
  const view = renderInBrowser({
    workstreams: [],
    onCreateWorkstream: async (options) => {
      creations.push(options)
    },
  })

  await openNewWorkstreamDialog(view, user)
  await user.type(view.getByRole('textbox', { name: 'Goal' }), 'Understand current behavior')
  await user.click(view.getByRole('radio', { name: /Brainstorm/ }))
  await user.click(view.getByRole('button', { name: 'Create Workstream' }))

  assert.deepEqual(creations, [
    { goal: 'Understand current behavior', mode: 'brainstorm', workingLocation: 'current-checkouts' },
  ])
})

test('keeps Workstream creation open and announces a failure', async () => {
  const user = createUser()
  const view = renderInBrowser({
    workstreams: [],
    onCreateWorkstream: async () => {
      throw new Error('Session storage is unavailable.')
    },
  })

  await openNewWorkstreamDialog(view, user)
  await user.type(view.getByRole('textbox', { name: 'Goal' }), 'Ship the change')
  await user.click(view.getByRole('button', { name: 'Create Workstream' }))

  assert.equal((await view.findByRole('alert')).textContent, 'Session storage is unavailable.')
  assert.ok(view.getByRole('dialog', { name: 'Create a Workstream' }))
})

test('archives a Workstream from its options menu', async () => {
  const updates: unknown[] = []
  const user = createUser()
  const view = renderInBrowser({
    onSetWorkstreamLifecycle: async (...values) => {
      updates.push(values)
    },
  })

  await user.click(view.getByRole('button', { name: 'Ship cancellation reasons options' }))
  await user.click(await view.findByRole('menuitem', { name: 'Archive Workstream' }))

  assert.deepEqual(updates, [['workstream-a', 'archived']])
})

test('creates a named Session inside its permanent Workstream', async () => {
  const creations: unknown[] = []
  const user = createUser()
  const view = renderInBrowser({
    onCreateSession: async (...values) => {
      creations.push(values)
    },
  })

  assert.equal(view.queryByText('New Session'), null)

  await user.click(view.getByRole('button', { name: 'New Session in Ship cancellation reasons' }))
  await user.type(view.getByRole('textbox', { name: 'Session name' }), 'Implement the change')
  await user.click(view.getByRole('button', { name: 'Create Session' }))

  assert.deepEqual(creations, [['workstream-a', { mode: 'implement', title: 'Implement the change' }]])
})
