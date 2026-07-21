import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sessionId } from '@/src/domain/session'
import type { SessionConfigurationModelSelection } from '@/src/session-configuration'
import type { PiSessionRuntime } from './pi-session-runtimes'
import { createSessionRuntimeConfiguration } from './pi-session-runtime-configuration'

const initialModel: SessionConfigurationModelSelection = { provider: 'provider', id: 'initial' }
const selectedModel: SessionConfigurationModelSelection = { provider: 'provider', id: 'selected' }

test('publishes the effective Model after a configuration change', async () => {
  let model = initialModel
  const runtime: PiSessionRuntime = {
    isStreaming: false,
    async prompt() {},
    subscribe() {
      return () => {}
    },
    async getConfiguration() {
      return {
        models: [],
        model,
        effort: 'off',
        supportedEfforts: ['off'],
      }
    },
    async setConfigurationModel(nextModel) {
      model = nextModel
    },
    dispose() {},
  }
  const configuration = createSessionRuntimeConfiguration({
    getRuntime: async () => runtime,
    withActivationGate: async (_sessionId, action) => action(),
  })
  const id = sessionId('session-1')
  const mutations: SessionConfigurationModelSelection[] = []
  configuration.subscribe((mutation) => {
    if (mutation.snapshot.model) mutations.push(mutation.snapshot.model)
  })

  const result = await configuration.setModel(id, selectedModel)

  assert.equal(result.status, 'applied')
  assert.deepEqual(result.snapshot.model, selectedModel)
  assert.deepEqual(mutations, [selectedModel])
})
