import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sessionId } from '@/src/domain/session'
import { initialWorkstreamSelection, updateWorkstreamSelection } from './workstream-selection'

test('selecting a Session also selects its owning Workstream', () => {
  const selected = updateWorkstreamSelection(initialWorkstreamSelection, {
    type: 'select-session',
    sessionId: sessionId('session-a'),
    workstreamId: 'workstream-a',
  })

  assert.deepEqual(selected, {
    sessionId: sessionId('session-a'),
    workstreamId: 'workstream-a',
  })
})

test('selecting a Workstream clears the active Session', () => {
  const selected = updateWorkstreamSelection(
    { sessionId: sessionId('session-a'), workstreamId: 'workstream-a' },
    { type: 'select-workstream', workstreamId: 'workstream-b' }
  )

  assert.deepEqual(selected, { workstreamId: 'workstream-b' })
})

test('starting a Workspace load clears previous Workstream knowledge', () => {
  const selected = updateWorkstreamSelection(
    { sessionId: sessionId('session-a'), workstreamId: 'workstream-a' },
    { type: 'start-workspace-load' }
  )

  assert.deepEqual(selected, initialWorkstreamSelection)
})
