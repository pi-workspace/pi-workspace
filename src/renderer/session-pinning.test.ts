import assert from 'node:assert/strict'
import test from 'node:test'
import { sessionId } from '@/src/domain/session'
import { getVisibleSessionIds, updateSessionPinning, type SessionPinningState } from './session-pinning'

const emptyState: SessionPinningState = { pinnedSessionIds: [] }

test('an unpinned active Session is visible', () => {
  const activeSessionId = sessionId('active-session')

  assert.deepEqual(getVisibleSessionIds(emptyState, activeSessionId), [activeSessionId])
})

test('pinned Sessions remain visible before an unpinned active Session', () => {
  const pinnedSessionId = sessionId('pinned-session')
  const activeSessionId = sessionId('active-session')
  const state = { pinnedSessionIds: [pinnedSessionId] }

  assert.deepEqual(getVisibleSessionIds(state, activeSessionId), [pinnedSessionId, activeSessionId])
})

test('an active pinned Session is not duplicated', () => {
  const activeSessionId = sessionId('active-session')
  const state = { pinnedSessionIds: [activeSessionId] }

  assert.deepEqual(getVisibleSessionIds(state, activeSessionId), [activeSessionId])
})

test('pinning a Session appends it to pin order', () => {
  const firstSessionId = sessionId('first-session')
  const secondSessionId = sessionId('second-session')
  const state = updateSessionPinning(
    { pinnedSessionIds: [firstSessionId] },
    { type: 'toggle-pin', sessionId: secondSessionId }
  )

  assert.deepEqual(state.pinnedSessionIds, [firstSessionId, secondSessionId])
})

test('unpinning a Session removes it from pin order', () => {
  const pinnedSessionId = sessionId('pinned-session')
  const state = updateSessionPinning(
    { pinnedSessionIds: [pinnedSessionId] },
    { type: 'toggle-pin', sessionId: pinnedSessionId }
  )

  assert.deepEqual(state.pinnedSessionIds, [])
})

test('switching Workspace clears pinned Sessions', () => {
  const state = updateSessionPinning({ pinnedSessionIds: [sessionId('pinned-session')] }, { type: 'reset' })

  assert.deepEqual(state, emptyState)
})

test('selecting a Workstream hides pinned Sessions without changing pin order', () => {
  const pinnedSessionId = sessionId('pinned-session')
  const state = { pinnedSessionIds: [pinnedSessionId] }

  assert.deepEqual(getVisibleSessionIds(state), [])
  assert.deepEqual(state.pinnedSessionIds, [pinnedSessionId])
})
