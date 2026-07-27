import { browser } from '@/src/renderer/test-dom'
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { cleanup, render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AgentActivity } from '@/src/session-timeline'
import { AgentActivityCard } from './agent-activity-card'

afterEach(() => cleanup())

const activity: AgentActivity = {
  type: 'activity',
  id: 'activity-1',
  runId: 'run-1',
  kind: 'validation',
  title: 'Validate the result',
  summary: 'All focused checks passed.',
  status: 'completed',
  operationCount: 2,
  fileCount: 1,
  artifacts: [
    { type: 'inspected-file', path: 'src/session.ts' },
    { type: 'validation', label: 'Tests', status: 'completed' },
  ],
  startedAt: 1,
  completedAt: 2,
}

test('a completed Agent Activity is collapsed and exposes its summary with native disclosure', async () => {
  const user = userEvent.setup({ document: browser.document as unknown as Document })
  const view = render(<AgentActivityCard activity={activity} loadDetails={async () => undefined} />, {
    container: browser.document.body as unknown as HTMLElement,
  })

  assert.equal((view.getByText('Validate the result').closest('details') as HTMLDetailsElement).open, false)
  await user.click(view.getByText('Validate the result'))

  assert.equal((view.getByText('Validate the result').closest('details') as HTMLDetailsElement).open, true)
})

test('an Agent Activity keeps its status available without displaying a corner label', () => {
  const view = render(<AgentActivityCard activity={activity} loadDetails={async () => undefined} />, {
    container: browser.document.body as unknown as HTMLElement,
  })

  const status = view.getByText('Completed')
  assert.equal(status.classList.contains('sr-only'), true)
})

test('an inspected-file artifact is omitted from the outcome summary', () => {
  const view = render(<AgentActivityCard activity={activity} loadDetails={async () => undefined} />, {
    container: browser.document.body as unknown as HTMLElement,
  })

  assert.equal(view.queryByText('src/session.ts'), null)
})

test('a validation artifact appears under Checks', () => {
  const view = render(<AgentActivityCard activity={activity} loadDetails={async () => undefined} />, {
    container: browser.document.body as unknown as HTMLElement,
  })

  assert.equal(view.getByText('Tests').closest('section')?.querySelector('h3')?.textContent, 'Checks')
})

test('a command artifact is omitted from the outcome summary', () => {
  const view = render(
    <AgentActivityCard
      activity={{
        ...activity,
        artifacts: [{ type: 'command', command: 'bun test', status: 'failed' }],
      }}
      loadDetails={async () => undefined}
    />,
    { container: browser.document.body as unknown as HTMLElement }
  )

  assert.equal(view.queryByText('bun test: failed'), null)
})

test('loads an operation-time preview only when a changed file is expanded', async () => {
  const user = userEvent.setup({ document: browser.document as unknown as Document })
  let loadCount = 0
  let opened: readonly [string | undefined, string] | undefined
  const view = render(
    <AgentActivityCard
      activity={{
        ...activity,
        artifacts: [{ type: 'file-change', path: 'src/session.ts', repositoryId: 'repository-a' }],
      }}
      loadDetails={async () => {
        loadCount += 1
        return {
          activityId: activity.id,
          operations: [
            {
              toolCallId: 'edit-1',
              label: 'edit',
              status: 'completed',
              input: '{}',
              truncated: false,
              preview: {
                kind: 'diff',
                path: 'src/session.ts',
                repositoryId: 'repository-a',
                content: '@@ -1 +1 @@\n-old\n+new',
                truncated: false,
              },
            },
          ],
        }
      }}
      onOpenCurrentDiff={(repositoryId, path) => {
        opened = [repositoryId, path]
      }}
    />,
    { container: browser.document.body as unknown as HTMLElement }
  )

  await user.click(view.getByText('Validate the result'))
  assert.equal(loadCount, 0)
  await user.click(view.getByRole('button', { name: 'src/session.ts' }))

  assert.equal(loadCount, 1)
  assert.ok(view.getByRole('region', { name: 'Operation-time preview for src/session.ts' }))
  await user.click(view.getByRole('button', { name: 'Open current diff' }))
  assert.deepEqual(opened, ['repository-a', 'src/session.ts'])
})

test('operations remain unloaded until their disclosure is opened', async () => {
  const user = userEvent.setup({ document: browser.document as unknown as Document })
  let loadCount = 0
  const view = render(
    <AgentActivityCard
      activity={activity}
      loadDetails={async () => {
        loadCount += 1
        return { activityId: activity.id, operations: [] }
      }}
    />,
    { container: browser.document.body as unknown as HTMLElement }
  )

  await user.click(view.getByText('Validate the result'))
  assert.equal(loadCount, 0)
  await user.click(view.getByRole('button', { name: 'Operations 2' }))
  assert.equal(loadCount, 1)
})

test('an expanded operation shows its tool name and input preview without raw input or output', async () => {
  const user = userEvent.setup({ document: browser.document as unknown as Document })
  const view = render(
    <AgentActivityCard
      activity={activity}
      loadDetails={async () => ({
        activityId: activity.id,
        operations: [
          {
            toolCallId: 'tool-1',
            label: 'read file',
            status: 'completed',
            inputPreview: 'src/session.ts',
            input: '{"path":"src/session.ts"}',
            output: '{"content":"raw output"}',
            truncated: false,
          },
        ],
      })}
    />,
    { container: browser.document.body as unknown as HTMLElement }
  )

  await user.click(view.getByText('Validate the result'))
  await user.click(view.getByRole('button', { name: 'Operations 2' }))
  await view.findByText('read file')

  assert.ok(view.getByText('src/session.ts'))
  assert.equal(view.queryByText(/raw output/), null)
})

test('a long operation input preview stays on one truncated line', async () => {
  const user = userEvent.setup({ document: browser.document as unknown as Document })
  const inputPreview = 'bun test --filter a-very-long-test-name-that-must-not-expand-the-operation-row'
  const view = render(
    <AgentActivityCard
      activity={activity}
      loadDetails={async () => ({
        activityId: activity.id,
        operations: [
          {
            toolCallId: 'tool-1',
            label: 'bash',
            status: 'completed',
            inputPreview,
            input: '',
            truncated: false,
          },
        ],
      })}
    />,
    { container: browser.document.body as unknown as HTMLElement }
  )

  await user.click(view.getByText('Validate the result'))
  await user.click(view.getByRole('button', { name: 'Operations 2' }))

  assert.equal((await view.findByText(inputPreview)).classList.contains('truncate'), true)
})

test('the operations disclosure closes the operation list', async () => {
  const user = userEvent.setup({ document: browser.document as unknown as Document })
  const view = render(
    <AgentActivityCard
      activity={activity}
      loadDetails={async () => ({
        activityId: activity.id,
        operations: [
          {
            toolCallId: 'tool-1',
            label: 'read file',
            status: 'completed',
            input: '',
            truncated: false,
          },
        ],
      })}
    />,
    { container: browser.document.body as unknown as HTMLElement }
  )

  await user.click(view.getByText('Validate the result'))
  const disclosure = view.getByRole('button', { name: 'Operations 2' })
  await user.click(disclosure)
  await view.findByText('read file')
  await user.click(disclosure)

  assert.equal(view.queryByText('read file'), null)
})

test('reopening unavailable operations does not repeat the detail request', async () => {
  const user = userEvent.setup({ document: browser.document as unknown as Document })
  let loadCount = 0
  const view = render(
    <AgentActivityCard
      activity={activity}
      loadDetails={async () => {
        loadCount += 1
        return undefined
      }}
    />,
    { container: browser.document.body as unknown as HTMLElement }
  )

  await user.click(view.getByText('Validate the result'))
  const disclosure = view.getByRole('button', { name: 'Operations 2' })
  await user.click(disclosure)
  await view.findByText('Details are unavailable.')
  await user.click(disclosure)
  await user.click(disclosure)

  assert.equal(loadCount, 1)
})
