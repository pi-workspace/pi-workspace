import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  denyBrowserPermissionCheck,
  denyBrowserPermissionRequest,
  denyWindowOpen,
  isTrustedRendererSource,
  isTrustedRendererUrl,
  preventUntrustedRendererNavigation,
  productionRendererUrl,
  resolveRendererAssetPath,
  resolveRendererUrl,
} from '@/src/main/renderer-security'

test('a packaged application ignores a development server URL', () => {
  assert.equal(
    resolveRendererUrl({
      isPackaged: true,
      developmentServerUrl: 'https://attacker.example',
      productionRendererUrl,
    }),
    'pi-workspace://renderer/index.html'
  )
})

test('an unpackaged application accepts a loopback development server', () => {
  assert.equal(
    resolveRendererUrl({
      isPackaged: false,
      developmentServerUrl: 'http://127.0.0.1:5173/',
      productionRendererUrl,
    }),
    'http://127.0.0.1:5173/'
  )
})

test('an unpackaged application accepts localhost as a development host', () => {
  assert.equal(
    resolveRendererUrl({
      isPackaged: false,
      developmentServerUrl: 'http://localhost:5173/',
      productionRendererUrl,
    }),
    'http://localhost:5173/'
  )
})

test('an unpackaged application rejects a remote development server', () => {
  assert.throws(
    () =>
      resolveRendererUrl({
        isPackaged: false,
        developmentServerUrl: 'https://attacker.example/',
        productionRendererUrl,
      }),
    /The development renderer URL must use HTTP on a loopback host\./
  )
})

test('an unpackaged application rejects HTTPS even on a loopback host', () => {
  assert.throws(
    () =>
      resolveRendererUrl({
        isPackaged: false,
        developmentServerUrl: 'https://localhost:5173/',
        productionRendererUrl,
      }),
    /The development renderer URL must use HTTP on a loopback host\./
  )
})

test('the configured renderer URL is trusted', () => {
  assert.equal(isTrustedRendererUrl(productionRendererUrl, productionRendererUrl), true)
})

test('another URL is not trusted even when it shares the renderer origin', () => {
  assert.equal(isTrustedRendererUrl('http://127.0.0.1:5173/other', 'http://127.0.0.1:5173/'), false)
})

test('navigation away from the trusted renderer is prevented', () => {
  let prevented = false

  preventUntrustedRendererNavigation(
    {
      preventDefault() {
        prevented = true
      },
    },
    'https://attacker.example/',
    productionRendererUrl
  )

  assert.equal(prevented, true)
})

test('navigation to the trusted renderer remains allowed', () => {
  let prevented = false

  preventUntrustedRendererNavigation(
    {
      preventDefault() {
        prevented = true
      },
    },
    productionRendererUrl,
    productionRendererUrl
  )

  assert.equal(prevented, false)
})

test('new renderer windows are denied', () => {
  assert.deepEqual(denyWindowOpen(), { action: 'deny' })
})

test('browser permission checks are denied', () => {
  assert.equal(denyBrowserPermissionCheck(), false)
})

test('browser permission requests are denied', () => {
  let permissionGranted: boolean | undefined

  denyBrowserPermissionRequest({}, 'media', (granted) => {
    permissionGranted = granted
  })

  assert.equal(permissionGranted, false)
})

test('application protocol requests resolve inside the renderer directory', () => {
  assert.equal(
    resolveRendererAssetPath('pi-workspace://renderer/assets/index.js', '/application/renderer'),
    '/application/renderer/assets/index.js'
  )
})

test('application protocol requests reject another host', () => {
  assert.equal(resolveRendererAssetPath('pi-workspace://attacker/index.html', '/application/renderer'), undefined)
})

test('application protocol requests reject traversal outside the renderer directory', () => {
  assert.equal(
    resolveRendererAssetPath('pi-workspace://renderer/%2e%2e/private.txt', '/application/renderer'),
    undefined
  )
})

test('the trusted top-level renderer is an allowed IPC source', () => {
  assert.equal(
    isTrustedRendererSource({
      isMainFrame: true,
      sourceUrl: productionRendererUrl,
      trustedRendererUrl: productionRendererUrl,
    }),
    true
  )
})

test('a subframe is not an allowed IPC source', () => {
  assert.equal(
    isTrustedRendererSource({
      isMainFrame: false,
      sourceUrl: productionRendererUrl,
      trustedRendererUrl: productionRendererUrl,
    }),
    false
  )
})
