import assert from 'node:assert/strict'
import { test } from 'node:test'
import { bundledReleaseNotes } from '../src/release-notes'
import { formatReleaseNoteAsMarkdown } from './release-note-markdown'

test('formats the latest bundled Release Note for a GitHub Release', () => {
  const markdown = formatReleaseNoteAsMarkdown(bundledReleaseNotes[0]!)

  assert.match(markdown, new RegExp(`^${bundledReleaseNotes[0]!.summary}`, 'm'))
  assert.match(markdown, /^## New$/m)
  assert.match(markdown, /^- Choose an available Skill from Composer autocomplete to guide Pi in a Session\./m)
})
