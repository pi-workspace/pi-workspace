import assert from 'node:assert/strict'
import { test } from 'node:test'
import { act, fireEvent, waitFor } from '@testing-library/react'
import { createDemoBridge } from '@/src/demo/demo-bridge'

test('the normal renderer initializes against the selected demo scenario', async () => {
  document.body.innerHTML = '<div id="app"></div>'
  window.piWorkspace = createDemoBridge('workstream')

  await act(async () => {
    await import('@/src/renderer/index')
  })

  await waitFor(() => {
    assert.match(document.body.textContent ?? '', /Make offline editing reliable in Atlas Notes/)
  })

  const brainstormLink = Array.from(document.querySelectorAll('span')).find(
    (candidate) => candidate.textContent === 'Design the offline editing experience'
  )
  assert.ok(brainstormLink)
  fireEvent.click(brainstormLink)

  await waitFor(() => {
    assert.match(document.body.textContent ?? '', /I’m building a note-taking app/)
    assert.match(document.body.textContent ?? '', /Mapped how Atlas Notes saves edits/)
    assert.match(document.body.textContent ?? '', /Identified the risky offline transitions/)
    assert.match(document.body.textContent ?? '', /Shaped a local-first implementation plan/)
  })

  const implementationLink = Array.from(document.querySelectorAll('span')).find(
    (candidate) => candidate.textContent === 'Build reliable offline editing'
  )
  assert.ok(implementationLink)
  fireEvent.click(implementationLink)

  await waitFor(() => {
    const modelControl = document.querySelector<HTMLInputElement>('input[aria-label="Model"]')
    assert.ok(modelControl)
    assert.equal(modelControl.value, 'GPT-5.6 Sol')
    const effortControl = document.querySelector<HTMLButtonElement>('button[aria-label="Effort"]')
    assert.ok(effortControl)
    assert.equal(effortControl.textContent, 'Medium')
    assert.match(document.body.textContent ?? '', /Let’s build the offline editing flow/)
    assert.match(document.body.textContent ?? '', /Mapped the existing save pipeline/)
    assert.match(document.body.textContent ?? '', /Built reliable offline editing/)
    assert.match(document.body.textContent ?? '', /Validated offline recovery/)
    assert.match(document.body.textContent ?? '', /Atlas Product/)
    assert.doesNotMatch(document.body.textContent ?? '', /demo-/i)
    assert.doesNotMatch(document.body.textContent ?? '', /Demo Workspace/)
  })
})
