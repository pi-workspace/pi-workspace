import { browser } from '@/src/renderer/test-dom'
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import type { SessionConfigurationBridge, SessionConfigurationMutation } from '@/src/session-configuration'
import { sessionId } from '@/src/domain/session'
import { useSessionConfiguration } from './session-configuration-state'

afterEach(() => cleanup())

test('shows only the subscribed Session configuration snapshot', async () => {
  let subscribedSessionId: string | undefined
  let publish: (mutation: SessionConfigurationMutation) => void = () => {}
  const firstSessionId = sessionId('session-a')
  const bridge: SessionConfigurationBridge = {
    async getSnapshot(sessionId) {
      return { sessionId, revision: 0, models: [], effort: 'off', supportedEfforts: ['off'] }
    },
    async setModel() {
      throw new Error('Not used in this test.')
    },
    async setEffort() {
      throw new Error('Not used in this test.')
    },
    async dismissWarning(sessionId) {
      return this.getSnapshot(sessionId)
    },
    subscribe(sessionId, listener) {
      subscribedSessionId = sessionId
      publish = listener

      return () => {}
    },
  }

  function ConfigurationValue() {
    const snapshot = useSessionConfiguration(firstSessionId, bridge)

    return <output>{snapshot?.effort ?? 'loading'}</output>
  }

  const view = render(<ConfigurationValue />, { container: browser.document.body as unknown as HTMLElement })

  await waitFor(() => assert.equal(view.getByText('off').textContent, 'off'))
  assert.equal(subscribedSessionId, firstSessionId)

  act(() => {
    publish({
      sessionId: firstSessionId,
      revision: 1,
      snapshot: { sessionId: firstSessionId, revision: 1, models: [], effort: 'high', supportedEfforts: ['high'] },
    })
  })

  await waitFor(() => assert.equal(view.getByText('high').textContent, 'high'))
})

test('keeps a newer broadcast when the initial snapshot arrives late', async () => {
  let resolveSnapshot: (snapshot: Awaited<ReturnType<SessionConfigurationBridge['getSnapshot']>>) => void = () => {}
  let publish: (mutation: SessionConfigurationMutation) => void = () => {}
  const firstSessionId = sessionId('session-a')
  const bridge: SessionConfigurationBridge = {
    getSnapshot() {
      return new Promise((resolve) => {
        resolveSnapshot = resolve
      })
    },
    async setModel() {
      throw new Error('Not used in this test.')
    },
    async setEffort() {
      throw new Error('Not used in this test.')
    },
    async dismissWarning(sessionId) {
      return this.getSnapshot(sessionId)
    },
    subscribe(_sessionId, listener) {
      publish = listener

      return () => {}
    },
  }

  function ConfigurationValue() {
    const snapshot = useSessionConfiguration(firstSessionId, bridge)

    return <output>{snapshot?.effort ?? 'loading'}</output>
  }

  const view = render(<ConfigurationValue />, { container: browser.document.body as unknown as HTMLElement })

  act(() => {
    publish({
      sessionId: firstSessionId,
      revision: 1,
      snapshot: { sessionId: firstSessionId, revision: 1, models: [], effort: 'high', supportedEfforts: ['high'] },
    })
  })
  await waitFor(() => assert.equal(view.getByText('high').textContent, 'high'))

  act(() => {
    resolveSnapshot({ sessionId: firstSessionId, revision: 0, models: [], effort: 'off', supportedEfforts: ['off'] })
  })

  await waitFor(() => assert.equal(view.getByText('high').textContent, 'high'))
})
