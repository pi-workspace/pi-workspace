import assert from 'node:assert/strict'
import test from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { RecoveryScreen } from './recovery-screen'

test('recovery-only screen withholds normal navigation and explains the diagnostic', () => {
  const markup = renderToStaticMarkup(
    <RecoveryScreen
      startup={{ status: 'recovery-only', diagnostic: 'The marker is missing.' }}
      onReset={async () => {}}
    />
  )

  assert.match(markup, /Recovery required/)
  assert.match(markup, /The marker is missing/)
  assert.doesNotMatch(markup, /Add Project|Projects|Recent sessions/)
})
