import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { cleanup, render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderToStaticMarkup } from 'react-dom/server'
import { sessionId } from '@/src/domain/session'
import type { Workstream } from '@/src/domain/workstream'
import { createEmptyWorkstreamKnowledge, type WorkstreamKnowledge } from '@/src/domain/workstream-knowledge-transitions'
import { browser } from '@/src/renderer/test-dom'
import { WorkstreamContext, WorkstreamContextLayout } from './workstream-context'

const workstream: Workstream = {
  id: 'workstream-a',
  workspaceId: 'workspace-a',
  goal: 'Ship cancellation reasons',
  lifecycle: 'active',
  workingLocation: 'current-checkouts',
  repositoryWorkingLocations: [
    {
      repositoryId: 'repository-a',
      repositoryName: 'Repository A',
      kind: 'current-checkout',
      availability: 'available',
      workingPath: '/repositories/a',
    },
  ],
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
}

afterEach(cleanup)

test('shows the selected Workstream goal as a single-line header with its full title available', () => {
  const markup = renderToStaticMarkup(<WorkstreamContext workstream={workstream} />)

  assert.match(markup, /class="[^"]*truncate[^"]*" title="Ship cancellation reasons"/)
})

test('hides the Repository checkouts section when no locations are available to show', () => {
  const markup = renderToStaticMarkup(
    <WorkstreamContext workstream={{ ...workstream, repositoryWorkingLocations: [] }} />
  )

  assert.doesNotMatch(markup, /Repository checkouts/)
})

test('shows Repository checkouts and opens one in the native file manager', async () => {
  const requests: string[][] = []
  const user = userEvent.setup({ document: browser.document as unknown as Document })
  const view = render(
    <WorkstreamContext
      workstream={workstream}
      onShowWorkingLocation={async (...ids) => {
        requests.push(ids)
      }}
    />,
    { container: browser.document.body as unknown as HTMLElement }
  )

  assert.ok(view.getByText('/repositories/a'))
  assert.ok(view.getByTitle('/repositories/a'))

  await user.click(view.getByRole('button', { name: 'Show Repository A in file manager' }))

  assert.deepEqual(requests, [['workstream-a', 'repository-a']])
})

test('shows the empty structured-context knowledge', () => {
  const knowledge = createEmptyWorkstreamKnowledge(workstream.id, workstream.goal!)
  const markup = renderToStaticMarkup(
    <WorkstreamContext
      workstream={workstream}
      stateResource={{ status: 'loaded', workstreamId: workstream.id, knowledge }}
    />
  )

  assert.doesNotMatch(markup, /No shared Workstream knowledge yet/)
  assert.doesNotMatch(markup, />Empty</)
  assert.doesNotMatch(markup, />Specification</)
  assert.doesNotMatch(markup, /Repository impacts/)
  assert.doesNotMatch(markup, /Shared knowledge/)
  assert.doesNotMatch(markup, /Implementation order/)
})

test('shows ready and immutable Specification Version states from the projection', () => {
  const knowledge = {
    workstreamId: workstream.id,
    goal: workstream.goal,
    knowledgeRevision: 1,
    specificationRevision: 1,
    specificationVersion: 2,
    currentRepositoryIds: ['repository-a'],
    records: [
      {
        id: 'evidence-a',
        kind: 'evidence',
        source: { kind: 'user-message', messageId: 'message-a' },
        revision: 1,
        provenance: { actor: 'pi', at: 1 },
        tombstoned: false,
      },
      {
        id: 'impact-a',
        kind: 'repository-impact',
        repositoryId: 'repository-a',
        classification: 'unaffected',
        summary: 'No Repository change is required.',
        evidenceIds: ['evidence-a'],
        revision: 1,
        provenance: { actor: 'pi', at: 1 },
        tombstoned: false,
      },
      {
        id: 'decision-a',
        kind: 'decision',
        status: 'accepted',
        summary: 'Keep the existing contract.',
        evidenceIds: ['evidence-a'],
        revision: 1,
        provenance: { actor: 'user', at: 2 },
        tombstoned: false,
      },
      {
        id: 'question-a',
        kind: 'open-question',
        classification: 'non-blocking',
        status: 'open',
        summary: 'Should follow-up documentation be expanded?',
        revision: 1,
        provenance: { actor: 'pi', at: 1 },
        tombstoned: false,
      },
      {
        id: 'step-a',
        kind: 'plan-step',
        summary: 'Document the verified contract.',
        repositoryIds: ['repository-a'],
        dependencyIds: [],
        evidenceIds: ['evidence-a'],
        revision: 1,
        provenance: { actor: 'pi', at: 1 },
        tombstoned: false,
      },
    ],
    specificationVersions: [
      {
        id: 'version-a',
        workstreamId: workstream.id,
        version: 1,
        knowledgeRevision: 1,
        specificationRevision: 1,
        readiness: { ready: true, blockers: [] },
        records: [],
        approvedAt: 1,
      },
    ],
  } as WorkstreamKnowledge

  const markup = renderToStaticMarkup(
    <WorkstreamContext
      workstream={workstream}
      stateResource={{ status: 'loaded', workstreamId: workstream.id, knowledge }}
    />
  )

  assert.match(markup, /Ready/)
  assert.match(markup, /Ready for approval/)
  assert.match(markup, /Version 1/)
  assert.match(markup, /No Repository change is required/)
  assert.match(markup, /Keep the existing contract/)
  assert.match(markup, /Should follow-up documentation be expanded/)
  assert.match(markup, /Document the verified contract/)
})

test('does not present failed Workstream knowledge as known-empty context', () => {
  const markup = renderToStaticMarkup(
    <WorkstreamContext
      workstream={workstream}
      stateResource={{ status: 'failed', workstreamId: workstream.id, message: 'State unavailable.' }}
    />
  )

  assert.match(markup, /State unavailable/)
  assert.doesNotMatch(markup, /No Repository impacts yet/)
})

test('does not show structured knowledge for a Quick Session Workstream', () => {
  const quickWorkstream: Workstream = {
    ...workstream,
    goal: undefined,
    sessions: [
      {
        id: sessionId('quick-session'),
        workstreamId: 'workstream-a',
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
  }

  assert.equal(renderToStaticMarkup(<WorkstreamContext workstream={quickWorkstream} />), '')
})

test('provides responsive access to the selected Workstream knowledge', async () => {
  const user = userEvent.setup({ document: browser.document as unknown as Document })
  const view = render(
    <WorkstreamContextLayout workstream={workstream}>
      <div>Active Session</div>
    </WorkstreamContextLayout>,
    { container: browser.document.body as unknown as HTMLElement }
  )

  await user.click(view.getByRole('button', { name: 'Open Workstream knowledge' }))

  assert.ok(view.getByRole('dialog', { name: 'Workstream knowledge' }))
  assert.match(view.getByRole('dialog').textContent ?? '', /Ship cancellation reasons/)
  assert.ok(view.getByRole('button', { name: 'Close Workstream knowledge' }))
})
