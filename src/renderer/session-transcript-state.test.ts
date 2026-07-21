import assert from 'node:assert/strict'
import test from 'node:test'
import { sessionId } from '@/src/domain/session'
import type { SessionTranscriptMutation, SessionTranscriptSnapshot } from '@/src/session-transcript'
import {
  initialWorkingSessionProjection,
  newestTranscriptMutation,
  projectWorkingSessionSnapshot,
} from '@/src/renderer/session-transcript-state'

function mutation(revision: number, announcement?: string): SessionTranscriptMutation {
  const id = sessionId('session-a')
  return {
    sessionId: id,
    revision,
    announcement,
    snapshot: { sessionId: id, revision, isWorking: true, runs: [], entries: [] },
  }
}

test('a stale mutation cannot replace a newer buffered revision', () => {
  assert.equal(newestTranscriptMutation(mutation(3), mutation(2)).revision, 3)
})

test('an announcement is retained when the same revision is coalesced', () => {
  assert.equal(newestTranscriptMutation(mutation(3, 'Completed'), mutation(3)).announcement, 'Completed')
})

function snapshot(id: string, revision: number, isWorking: boolean): SessionTranscriptSnapshot {
  const ownedSessionId = sessionId(id)

  return { sessionId: ownedSessionId, revision, isWorking, runs: [], entries: [] }
}

test('initial timeline snapshots project working Session membership', () => {
  const trackedSessionIds = new Set([sessionId('session-a'), sessionId('session-b')])
  const afterIdleSession = projectWorkingSessionSnapshot(
    initialWorkingSessionProjection,
    trackedSessionIds,
    snapshot('session-a', 1, false)
  )
  const afterWorkingSession = projectWorkingSessionSnapshot(
    afterIdleSession,
    trackedSessionIds,
    snapshot('session-b', 1, true)
  )

  assert.deepEqual([...afterWorkingSession.workingSessionIds], [sessionId('session-b')])
})

test('a newer timeline mutation removes a settled Session from working membership', () => {
  const trackedSessionIds = new Set([sessionId('session-a')])
  const working = projectWorkingSessionSnapshot(
    initialWorkingSessionProjection,
    trackedSessionIds,
    snapshot('session-a', 2, true)
  )
  const settled = projectWorkingSessionSnapshot(working, trackedSessionIds, snapshot('session-a', 3, false))

  assert.deepEqual([...settled.workingSessionIds], [])
})

test('a stale initial snapshot cannot replace a newer working mutation', () => {
  const trackedSessionIds = new Set([sessionId('session-a')])
  const working = projectWorkingSessionSnapshot(
    initialWorkingSessionProjection,
    trackedSessionIds,
    snapshot('session-a', 4, true)
  )
  const afterStaleSnapshot = projectWorkingSessionSnapshot(working, trackedSessionIds, snapshot('session-a', 3, false))

  assert.equal(afterStaleSnapshot, working)
  assert.deepEqual([...afterStaleSnapshot.workingSessionIds], [sessionId('session-a')])
})

test('timeline snapshots outside the selected Workspace Session set are ignored', () => {
  const projection = projectWorkingSessionSnapshot(
    initialWorkingSessionProjection,
    new Set([sessionId('session-a')]),
    snapshot('session-b', 1, true)
  )

  assert.equal(projection, initialWorkingSessionProjection)
})
