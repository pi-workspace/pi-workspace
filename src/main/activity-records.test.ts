import assert from 'node:assert/strict'
import test from 'node:test'
import { isActivityLayerRecord } from './activity-records'

test('rejects malformed run records', () => {
  const malformedRuns = [
    { version: 1, type: 'run' },
    {
      version: 1,
      type: 'run',
      run: {
        id: '',
        initiatingMessageId: 'message-1',
        status: 'waiting',
        activityIds: [1],
        startedAt: Number.NaN,
        completedAt: 'later',
      },
    },
  ]

  for (const record of malformedRuns) assert.equal(isActivityLayerRecord(record), false)
})

test('rejects malformed activity records', () => {
  const malformedActivities = [
    { version: 1, type: 'activity' },
    {
      version: 1,
      type: 'activity',
      activity: {
        type: 'activity',
        id: 'activity-1',
        runId: 'run-1',
        kind: 'coding',
        title: 'Implement validation',
        expectedOutcome: 1,
        status: 'waiting',
        operationCount: -1,
        fileCount: 0.5,
        artifacts: [{ type: 'inspected-file' }],
        startedAt: -1,
      },
    },
  ]

  for (const record of malformedActivities) assert.equal(isActivityLayerRecord(record), false)
})

test('rejects malformed operation records', () => {
  const malformedOperations = [
    { version: 1, type: 'operation' },
    {
      version: 1,
      type: 'operation',
      execution: {
        toolCallId: '',
        activityId: 'activity-1',
        toolName: 'read',
        label: 'read',
        status: 'waiting',
        inputPreview: 1,
      },
    },
  ]

  for (const record of malformedOperations) assert.equal(isActivityLayerRecord(record), false)
})

test('rejects malformed activity removal records', () => {
  assert.equal(isActivityLayerRecord({ version: 1, type: 'activity-removed', activityId: '' }), false)
})

test('rejects malformed diagnostic records', () => {
  assert.equal(
    isActivityLayerRecord({
      version: 1,
      type: 'diagnostic',
      runId: '',
      kind: 'unknown',
      explanation: 1,
    }),
    false
  )
})

test('rejects malformed repair records', () => {
  assert.equal(isActivityLayerRecord({ version: 1, type: 'repair', runId: '', outcome: 'running' }), false)
})

test('accepts complete historical records', () => {
  const records = [
    {
      version: 1,
      type: 'run',
      run: {
        id: 'run-1',
        initiatingMessageId: 'message-1',
        status: 'completed',
        activityIds: ['activity-1'],
        startedAt: 1,
        completedAt: 2,
      },
    },
    {
      version: 1,
      type: 'activity',
      activity: {
        type: 'activity',
        id: 'activity-1',
        runId: 'run-1',
        kind: 'implementation',
        title: 'Implement validation',
        expectedOutcome: 'Malformed records are ignored.',
        summary: 'Added persistence-boundary validation.',
        status: 'completed',
        operationCount: 1,
        fileCount: 1,
        secondaryLine: 'Complete',
        artifacts: [
          { type: 'inspected-file', path: 'src/main/activity-records.ts' },
          { type: 'file-change', path: 'src/main/activity-records.ts', additions: 10, deletions: 1 },
          { type: 'command', command: 'bun test', status: 'completed', rawResultReference: 'tool-1' },
          { type: 'validation', label: 'Tests', status: 'completed', passed: 1, failed: 0, skipped: 0 },
        ],
        startedAt: 1,
        completedAt: 2,
      },
    },
    {
      version: 1,
      type: 'operation',
      execution: {
        toolCallId: 'tool-1',
        activityId: 'activity-1',
        toolName: 'read',
        label: 'read',
        status: 'completed',
        rawResultReference: 'tool-1',
        inputPreview: 'src/main/activity-records.ts',
      },
    },
    { version: 1, type: 'activity-removed', activityId: 'activity-1' },
    {
      version: 1,
      type: 'diagnostic',
      runId: 'run-1',
      kind: 'provider-failure',
      explanation: 'Provider failed.',
    },
    { version: 1, type: 'repair', runId: 'run-1', outcome: 'completed' },
  ]

  for (const record of records) assert.equal(isActivityLayerRecord(record), true)
})
