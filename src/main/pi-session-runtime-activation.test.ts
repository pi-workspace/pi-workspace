import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sessionId } from '@/src/domain/session'
import { createSessionRuntimeActivationGate } from './pi-session-runtime-activation'

test('serializes Session activation actions', async () => {
  const gate = createSessionRuntimeActivationGate()
  const id = sessionId('session-1')
  const order: string[] = []
  let releaseFirst: () => void = () => {}
  const firstRelease = new Promise<void>((resolve) => {
    releaseFirst = resolve
  })

  const first = gate.run(id, async () => {
    order.push('first-started')
    await firstRelease
    order.push('first-finished')
  })
  const second = gate.run(id, async () => {
    order.push('second-started')
  })

  await Promise.resolve()
  assert.deepEqual(order, ['first-started'])

  releaseFirst()
  await Promise.all([first, second])

  assert.deepEqual(order, ['first-started', 'first-finished', 'second-started'])
})
