import { browser } from '@/src/renderer/test-dom'
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { cleanup, render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WorkspaceOnboardingScreen } from './workspace-onboarding-screen'

afterEach(() => {
  cleanup()
})

test('submits the first Workspace name', async () => {
  const createdNames: string[] = []
  const user = userEvent.setup({ document: browser.document as unknown as Document })
  const view = render(
    <WorkspaceOnboardingScreen
      onCreateWorkspace={async (name) => {
        createdNames.push(name)
      }}
    />,
    { container: browser.document.body as unknown as HTMLElement }
  )

  await user.type(view.getByRole('textbox', { name: 'Workspace name' }), 'My Workspace')
  await user.click(view.getByRole('button', { name: 'Select Repository and create Workspace' }))

  assert.deepEqual(createdNames, ['My Workspace'])
})

test('does not submit a whitespace-only Workspace name', async () => {
  const createdNames: string[] = []
  const user = userEvent.setup({ document: browser.document as unknown as Document })
  const view = render(
    <WorkspaceOnboardingScreen
      onCreateWorkspace={async (name) => {
        createdNames.push(name)
      }}
    />,
    { container: browser.document.body as unknown as HTMLElement }
  )

  await user.type(view.getByRole('textbox', { name: 'Workspace name' }), ' ')

  const submit = view.getByRole('button', { name: 'Select Repository and create Workspace' })
  assert.equal(submit.hasAttribute('disabled'), true)
  await user.click(submit)

  assert.deepEqual(createdNames, [])
})

test('announces a Workspace creation error', async () => {
  const user = userEvent.setup({ document: browser.document as unknown as Document })
  const view = render(
    <WorkspaceOnboardingScreen
      onCreateWorkspace={async () => {
        throw new Error('The selected directory is not a Git Repository.')
      }}
    />,
    { container: browser.document.body as unknown as HTMLElement }
  )

  await user.type(view.getByRole('textbox', { name: 'Workspace name' }), 'My Workspace')
  await user.click(view.getByRole('button', { name: 'Select Repository and create Workspace' }))

  assert.equal((await view.findByRole('alert')).textContent, 'The selected directory is not a Git Repository.')
})
