import { browser } from '@/src/renderer/test-dom'
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { cleanup, render, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderToStaticMarkup } from 'react-dom/server'
import { WorkspaceNavigation } from './workspace-navigation'

type WorkspaceNavigationProperties = Parameters<typeof WorkspaceNavigation>[0]

const workspaces: WorkspaceNavigationProperties['workspaces'] = [
  {
    id: 'workspace-a',
    name: 'Workspace A',
    repositories: [
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
      {
        availability: 'unavailable',
        directoryPath: '/repositories/b',
        id: 'repository-b',
        membershipId: 'membership-b',
        name: 'Repository B',
        relationships: [],
        role: '',
        validationCommands: [],
      },
    ],
  },
]

function createNavigation(properties: Partial<WorkspaceNavigationProperties> = {}) {
  return (
    <WorkspaceNavigation
      onAddRepositories={async () => {}}
      onCreateWorkspace={async () => {}}
      onRemoveRepository={async () => {}}
      onRenameWorkspace={async () => {}}
      onSelectWorkspace={() => {}}
      onUpdateMembership={async () => {}}
      selectedWorkspaceId="workspace-a"
      workspaces={workspaces}
      {...properties}
    >
      <div>Workstream navigation</div>
    </WorkspaceNavigation>
  )
}

function renderInBrowser(properties: Partial<WorkspaceNavigationProperties> = {}) {
  return render(createNavigation(properties), { container: browser.document.body as unknown as HTMLElement })
}

function createUser() {
  return userEvent.setup({ document: browser.document as unknown as Document })
}

afterEach(() => {
  cleanup()
})

test('keeps Repository controls out of the Workspace sidebar', () => {
  const markup = renderToStaticMarkup(createNavigation())

  assert.match(markup, /aria-label="Switch Workspace"/)
  assert.match(markup, /aria-label="New Workspace"/)
  assert.doesNotMatch(markup, /aria-label="Add Repositories"/)
  assert.doesNotMatch(markup, /aria-label="Repository A settings"/)
})

test('keeps membership changes behind Repository settings', () => {
  const markup = renderToStaticMarkup(createNavigation())

  assert.doesNotMatch(markup, /aria-label="Remove Repository A"/)
  assert.doesNotMatch(markup, />Edit membership</)
  assert.doesNotMatch(markup, />Remove Repository</)
})

test('identifies unavailable Repositories in Workspace settings', async () => {
  const user = createUser()
  const view = renderInBrowser()

  await user.click(view.getByRole('button', { name: 'Switch Workspace' }))
  await user.click(await view.findByRole('menuitem', { name: 'Workspace settings' }))

  assert.ok(view.getByText('Unavailable', { exact: true }))
})

test('creates a Workspace from the dialog', async () => {
  const createdNames: string[] = []
  const user = createUser()
  const view = renderInBrowser({
    onCreateWorkspace: async (name) => {
      createdNames.push(name)
    },
  })

  await user.click(view.getByRole('button', { name: 'New Workspace' }))
  await user.type(view.getByRole('textbox', { name: 'Workspace name' }), 'New Workspace')
  await user.click(view.getByRole('button', { name: 'Select Repositories' }))

  assert.deepEqual(createdNames, ['New Workspace'])
})

test('keeps the dialog open when Workspace creation fails', async () => {
  const user = createUser()
  const view = renderInBrowser({
    onCreateWorkspace: async () => {
      throw new Error('The selected directory is not a Git Repository.')
    },
  })

  await user.click(view.getByRole('button', { name: 'New Workspace' }))
  await user.click(view.getByRole('button', { name: 'Select Repositories' }))

  assert.equal((await view.findByRole('alert')).textContent, 'The selected directory is not a Git Repository.')
  assert.ok(view.getByRole('dialog', { name: 'Create Workspace' }))
})

test('opens Workspace creation with the keyboard', async () => {
  const user = createUser()
  const view = renderInBrowser()

  await user.tab()
  await user.tab()
  assert.equal(browser.document.activeElement, view.getByRole('button', { name: 'New Workspace' }))
  await user.keyboard('{Enter}')

  assert.ok(view.getByRole('dialog', { name: 'Create Workspace' }))
})

test('adds Repositories from Workspace settings', async () => {
  const addedWorkspaceIds: string[] = []
  const user = createUser()
  const view = renderInBrowser({
    onAddRepositories: async (workspaceId) => {
      addedWorkspaceIds.push(workspaceId)
    },
  })

  await user.click(view.getByRole('button', { name: 'Switch Workspace' }))
  await user.click(await view.findByRole('menuitem', { name: 'Workspace settings' }))
  await user.click(view.getByRole('button', { name: 'Add Repositories' }))

  assert.deepEqual(addedWorkspaceIds, ['workspace-a'])
  assert.ok(view.getByRole('dialog', { name: 'Workspace settings' }))
})

test('renames the selected Workspace', async () => {
  const renames: [string, string][] = []
  const user = createUser()
  const view = renderInBrowser({
    onRenameWorkspace: async (workspaceId, name) => {
      renames.push([workspaceId, name])
    },
  })

  await user.click(view.getByRole('button', { name: 'Switch Workspace' }))
  await user.click(await view.findByRole('menuitem', { name: 'Workspace settings' }))
  const nameInput = view.getByRole('textbox', { name: 'Workspace name' })
  await user.clear(nameInput)
  await user.type(nameInput, 'Renamed Workspace')
  await user.click(view.getByRole('button', { name: 'Save changes' }))

  assert.deepEqual(renames, [['workspace-a', 'Renamed Workspace']])
})

test('returns to Workspace settings when Repository settings are cancelled', async () => {
  const user = createUser()
  const view = renderInBrowser()

  await user.click(view.getByRole('button', { name: 'Switch Workspace' }))
  await user.click(await view.findByRole('menuitem', { name: 'Workspace settings' }))
  await user.click(view.getByRole('button', { name: 'Repository A settings' }))
  await user.click(view.getByRole('button', { name: 'Cancel' }))

  assert.ok(view.getByRole('dialog', { name: 'Workspace settings' }))
})

test('updates membership metadata from Repository settings', async () => {
  const updates: Parameters<WorkspaceNavigationProperties['onUpdateMembership']>[] = []
  const user = createUser()
  const view = renderInBrowser({
    onUpdateMembership: async (...update) => {
      updates.push(update)
    },
  })

  await user.click(view.getByRole('button', { name: 'Switch Workspace' }))
  await user.click(await view.findByRole('menuitem', { name: 'Workspace settings' }))
  await user.click(view.getByRole('button', { name: 'Repository A settings' }))
  await user.type(view.getByRole('textbox', { name: 'Role in this Workspace' }), 'Desktop application')
  await user.click(view.getByRole('checkbox', { name: 'Repository B' }))
  await user.type(view.getByRole('textbox', { name: 'Default validation commands' }), 'bun test')
  await user.click(view.getByRole('button', { name: 'Save changes' }))

  assert.deepEqual(updates, [
    [
      'workspace-a',
      'membership-a',
      {
        role: 'Desktop application',
        relationships: ['membership-b'],
        validationCommands: ['bun test'],
      },
    ],
  ])
  assert.ok(view.getByRole('dialog', { name: 'Workspace settings' }))
})

test('removes a membership from Repository settings', async () => {
  const removals: [string, string][] = []
  const user = createUser()
  const view = renderInBrowser({
    onRemoveRepository: async (workspaceId, membershipId) => {
      removals.push([workspaceId, membershipId])
    },
  })

  await user.click(view.getByRole('button', { name: 'Switch Workspace' }))
  await user.click(await view.findByRole('menuitem', { name: 'Workspace settings' }))
  await user.click(view.getByRole('button', { name: 'Repository A settings' }))
  await user.click(view.getByRole('button', { name: 'Remove Repository' }))

  await waitFor(() => assert.deepEqual(removals, [['workspace-a', 'membership-a']]))
  assert.ok(view.getByRole('dialog', { name: 'Workspace settings' }))
})
