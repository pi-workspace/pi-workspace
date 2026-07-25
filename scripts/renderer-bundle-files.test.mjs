import { expect, test } from 'bun:test'
import { identifyRendererBundleFiles } from './renderer-bundle-files.mjs'

test('identifies the renderer entry from Windows paths', () => {
  const entry = 'dist\\renderer\\assets\\index-abc123.js'

  expect(identifyRendererBundleFiles([entry]).entry).toBe(entry)
})
