import assert from 'node:assert/strict'
import test from 'node:test'
import { createStartupFailureUrl, startupRetryUrl } from '@/src/main/startup-failure'

function decodeDataUrl(url: string): string {
  return decodeURIComponent(url.slice(url.indexOf(',') + 1))
}

test('initialization failure fallback offers a restart without exposing internal details', () => {
  const html = decodeDataUrl(createStartupFailureUrl('initialization'))

  assert.match(html, /Railyard could not start/)
  assert.match(html, new RegExp(`href="${startupRetryUrl}"`))
  assert.doesNotMatch(html, /stack|sqlite|provider/i)
})

test('renderer-load failure fallback identifies the failed window boundary', () => {
  const html = decodeDataUrl(createStartupFailureUrl('renderer-load'))

  assert.match(html, /could not open its window/)
  assert.match(html, /Content-Security-Policy/)
})
