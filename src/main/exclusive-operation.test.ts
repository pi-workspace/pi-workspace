import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createExclusiveOperation } from './exclusive-operation'

test('rejects overlapping privileged operations instead of queueing them', async () => {
  let finishFirst: () => void = () => {}
  const firstWork = new Promise<void>((resolve) => {
    finishFirst = resolve
  })
  const operation = createExclusiveOperation('A privileged operation is already in progress.')
  const first = operation.run(() => firstWork)

  await assert.rejects(
    operation.run(async () => {}),
    /A privileged operation is already in progress\./
  )
  finishFirst()
  await first
})

test('allows another privileged operation after the current one settles', async () => {
  const operation = createExclusiveOperation('Busy.')

  await operation.run(async () => {})
  await assert.doesNotReject(operation.run(async () => {}))
})
