import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { cleanup, render, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { browser } from '@/src/renderer/test-dom'
import { sessionId } from '@/src/domain/session'
import type { OwnedSession } from '@/src/domain/workstream'
import { SessionForkDialog } from './session-fork-dialog'

const source: OwnedSession = {
  id: sessionId('source-session'),
  workstreamId: 'workstream-a',
  title: 'Source Session',
  mode: 'implement',
  availability: 'available',
  repositoryAccess: { kind: 'managed' },
}

afterEach(() => cleanup())

test('forks from the preselected canonical user-message position', async () => {
  const user = userEvent.setup()
  const requests: unknown[] = []
  const view = render(
    <SessionForkDialog
      open
      session={source}
      initialPosition={1}
      workingLocation="current-checkouts"
      getForkPoints={async () => [
        { entryId: 'aaaa0001', text: 'First approach', position: 1, total: 2 },
        { entryId: 'bbbb0002', text: 'Second approach', position: 2, total: 2 },
      ]}
      onClose={() => {}}
      onFork={async (options) => {
        requests.push(options)
      }}
    />,
    { container: browser.document.body as unknown as HTMLElement }
  )

  await waitFor(() => assert.ok(view.getByText('First approach', { exact: true })))
  await user.click(view.getByRole('button', { name: 'Fork Session' }))

  assert.deepEqual(requests, [{ entryId: 'aaaa0001', title: 'Fork of Source Session' }])
})
