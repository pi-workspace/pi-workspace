import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  developmentContentSecurityPolicy,
  productionContentSecurityPolicy,
} from '@/src/renderer-content-security-policy'

test('production CSP allows scripts and connections only from the application origin', () => {
  assert.match(productionContentSecurityPolicy, /script-src 'self' 'wasm-unsafe-eval'/)
  assert.match(productionContentSecurityPolicy, /connect-src 'self'/)
  assert.doesNotMatch(productionContentSecurityPolicy, /https?:|wss?:|script-src[^;]*'unsafe-inline'/)
})

test('development CSP allows only loopback Vite connections', () => {
  assert.match(
    developmentContentSecurityPolicy,
    /connect-src 'self' ws:\/\/localhost:\* ws:\/\/127\.0\.0\.1:\* ws:\/\/\[::1\]:\*/
  )
  assert.doesNotMatch(developmentContentSecurityPolicy, /https?:|wss?:\/\/(?!localhost|127\.0\.0\.1|\[::1\])/)
})
