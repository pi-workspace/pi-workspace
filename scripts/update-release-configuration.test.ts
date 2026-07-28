import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { validateUpdateReleaseConfiguration } from './update-release-configuration'

async function packageMetadata(): Promise<unknown> {
  return JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
}

test('accepts the configured GitHub beta source and universal macOS updater payload', async () => {
  assert.deepEqual(validateUpdateReleaseConfiguration(await packageMetadata()), [])
})

test('rejects release configuration without a macOS ZIP updater payload', async () => {
  const metadata = (await packageMetadata()) as { build: { mac: { target: unknown[] } } }
  const withoutZip = {
    ...metadata,
    build: {
      ...metadata.build,
      mac: {
        ...metadata.build.mac,
        target: metadata.build.mac.target.filter(
          (target) => !(target && typeof target === 'object' && 'target' in target && target.target === 'zip')
        ),
      },
    },
  }

  assert.match(validateUpdateReleaseConfiguration(withoutZip).join('\n'), /ZIP/i)
})
