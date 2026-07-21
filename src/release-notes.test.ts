import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { bundledReleaseNotes, validateReleaseNotes } from './release-notes'

test('bundled Release Notes satisfy the release lifecycle', async () => {
  const packageMetadata = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
    version: string
  }

  assert.deepEqual(validateReleaseNotes(bundledReleaseNotes, packageMetadata.version), [])
})

test('uses current Repository terminology in user-facing Release Notes', () => {
  assert.doesNotMatch(JSON.stringify(bundledReleaseNotes), /Projects/)
  assert.match(JSON.stringify(bundledReleaseNotes), /Repositories/)
})

test('rejects duplicate Release Note versions', () => {
  const duplicateReleaseNotes = [bundledReleaseNotes[0]!, bundledReleaseNotes[0]!]

  assert.match(validateReleaseNotes(duplicateReleaseNotes, bundledReleaseNotes[0]!.version).join('\n'), /unique/i)
})

test('rejects Release Notes that are not ordered newest-first', () => {
  const releaseNotes = [
    { ...bundledReleaseNotes[0]!, version: '1.0.0' },
    { ...bundledReleaseNotes[0]!, version: '2.0.0' },
  ]

  assert.match(validateReleaseNotes(releaseNotes, '1.0.0').join('\n'), /newest-first/i)
})

test('orders prerelease versions by semantic-version precedence', () => {
  const releaseNotes = [
    { ...bundledReleaseNotes[0]!, version: '1.0.0-alpha.1' },
    { ...bundledReleaseNotes[0]!, version: '1.0.0-alpha.2' },
  ]

  assert.match(validateReleaseNotes(releaseNotes, '1.0.0-alpha.1').join('\n'), /newest-first/i)
})

test('rejects a Release Note without a semantic version', () => {
  const releaseNotes = [{ ...bundledReleaseNotes[0]!, version: 'version-one' }]

  assert.match(validateReleaseNotes(releaseNotes, 'version-one').join('\n'), /semantic version/i)
})

test('rejects a Release Note without a valid release date', () => {
  const releaseNotes = [{ ...bundledReleaseNotes[0]!, releaseDate: '' }]

  assert.match(validateReleaseNotes(releaseNotes, bundledReleaseNotes[0]!.version).join('\n'), /release date/i)
})

test('rejects a Release Note without a summary', () => {
  const releaseNotes = [{ ...bundledReleaseNotes[0]!, summary: '  ' }]

  assert.match(validateReleaseNotes(releaseNotes, bundledReleaseNotes[0]!.version).join('\n'), /summary/i)
})

test('rejects a Release Note without a change', () => {
  const releaseNotes = [
    {
      ...bundledReleaseNotes[0]!,
      changes: { new: [], improved: [], fixed: [] },
    },
  ]

  assert.match(validateReleaseNotes(releaseNotes, bundledReleaseNotes[0]!.version).join('\n'), /change group/i)
})

test('rejects an empty Release Note change', () => {
  const releaseNotes = [
    {
      ...bundledReleaseNotes[0]!,
      changes: { new: ['  '], improved: [], fixed: [] },
    },
  ]

  assert.match(validateReleaseNotes(releaseNotes, bundledReleaseNotes[0]!.version).join('\n'), /change item/i)
})
