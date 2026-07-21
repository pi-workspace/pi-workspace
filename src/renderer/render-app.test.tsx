import { browser } from '@/src/renderer/test-dom'
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { cleanup, render } from '@testing-library/react'
import { RendererErrorBoundary } from '@/src/renderer/render-app'

afterEach(cleanup)

function BrokenRenderer(): never {
  throw new Error('private renderer detail')
}

test('unexpected React rendering failures show a safe reload fallback', async () => {
  const originalError = console.error
  console.error = () => {}

  try {
    const view = render(
      <RendererErrorBoundary>
        <BrokenRenderer />
      </RendererErrorBoundary>,
      { container: browser.document.body as unknown as HTMLElement }
    )

    const alert = await view.findByRole('alert')
    assert.match(alert.textContent ?? '', /Pi Workspace encountered a problem/)
    assert.doesNotMatch(alert.textContent ?? '', /private renderer detail/)
    assert.ok(view.getByRole('button', { name: 'Reload Pi Workspace' }))
  } finally {
    console.error = originalError
  }
})
