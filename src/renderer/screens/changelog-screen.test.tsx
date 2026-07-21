import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReleaseNote } from '@/src/release-notes'
import { ChangelogScreen } from './changelog-screen'

const releaseNotes: readonly ReleaseNote[] = [
  {
    version: '2.0.0',
    releaseDate: '2026-07-16',
    summary: 'The newest release.',
    changes: { new: ['A feature'], improved: [], fixed: ['A fix'] },
  },
  {
    version: '1.0.0',
    releaseDate: '2026-06-01',
    summary: 'The first release.',
    changes: { new: [], improved: ['First improvement'], fixed: [] },
  },
]

test('places Back and the page title together in the top header', () => {
  const markup = renderToStaticMarkup(<ChangelogScreen releaseNotes={releaseNotes} onBack={() => {}} />)
  const header = markup.match(/<header[^>]*>([\s\S]*?)<\/header>/)?.[1] ?? ''

  assert.match(header, />Back</)
  assert.match(header, />Changelog</)
})

test('renders Release Notes newest-first', () => {
  const markup = renderToStaticMarkup(<ChangelogScreen releaseNotes={releaseNotes} onBack={() => {}} />)

  assert.ok(markup.indexOf('2.0.0') < markup.indexOf('1.0.0'))
})

test('labels only the newest Release Note as Latest', () => {
  const markup = renderToStaticMarkup(<ChangelogScreen releaseNotes={releaseNotes} onBack={() => {}} />)

  assert.equal(markup.match(/Latest/g)?.length, 1)
})

test('omits empty change groups', () => {
  const markup = renderToStaticMarkup(<ChangelogScreen releaseNotes={releaseNotes} onBack={() => {}} />)

  assert.equal(markup.match(/>New</g)?.length, 1)
  assert.equal(markup.match(/>Improved</g)?.length, 1)
  assert.equal(markup.match(/>Fixed</g)?.length, 1)
})

test('renders a formatted Release Note date', () => {
  const markup = renderToStaticMarkup(<ChangelogScreen releaseNotes={releaseNotes} onBack={() => {}} />)

  assert.match(markup, /dateTime="2026-07-16"/i)
})

test('renders a Release Note summary', () => {
  const markup = renderToStaticMarkup(<ChangelogScreen releaseNotes={releaseNotes} onBack={() => {}} />)

  assert.match(markup, /The newest release\./)
})
