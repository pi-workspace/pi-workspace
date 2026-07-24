import assert from 'node:assert/strict'
import test from 'node:test'
import { getDemoScenario, getDemoScenarioPresentation } from './demo-scenarios'

test('provides an active Session with transcript-visible steering and queued follow-ups', () => {
  const scenario = getDemoScenario('queued-messages')
  const transcript = scenario.transcriptsBySessionId['queued-messages']
  const presentation = getDemoScenarioPresentation('queued-messages')

  assert.equal(transcript?.isWorking, true)
  assert.equal(presentation?.activeSessionId, 'queued-messages')
  assert.deepEqual(
    transcript?.entries
      .filter((entry) => entry.type === 'message' && entry.message.role === 'user')
      .map((entry) => (entry.type === 'message' ? entry.message.id : '')),
    ['message-delivery-request', 'message-delivery-steer']
  )
  assert.deepEqual(
    transcript?.queuedFollowUps?.map(({ id }) => id),
    ['message-delivery-follow-up', 'message-delivery-validation', 'message-delivery-accessibility']
  )
})
