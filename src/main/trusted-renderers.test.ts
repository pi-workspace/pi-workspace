import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createTrustedRendererAuthority, type ManagedRendererWindow } from './trusted-renderers'

function rendererWindow(url = 'app://workspace/index.html') {
  const sent: unknown[][] = []
  const mainFrame = { url }
  const window: ManagedRendererWindow = {
    webContents: {
      mainFrame,
      send: (...arguments_: unknown[]) => sent.push(arguments_),
    },
  }

  return { window, mainFrame, sent }
}

test('authorizes the registered application window main frame at the trusted renderer URL', () => {
  const authority = createTrustedRendererAuthority('app://workspace/index.html')
  const renderer = rendererWindow()
  authority.register(renderer.window)

  assert.equal(authority.isAuthorized({ sender: renderer.window.webContents, senderFrame: renderer.mainFrame }), true)
})

test('rejects an unregistered window even when it loaded the trusted renderer URL', () => {
  const authority = createTrustedRendererAuthority('app://workspace/index.html')
  const registered = rendererWindow()
  const unexpected = rendererWindow()
  authority.register(registered.window)

  assert.equal(
    authority.isAuthorized({ sender: unexpected.window.webContents, senderFrame: unexpected.mainFrame }),
    false
  )
})

test('rejects a registered window subframe', () => {
  const authority = createTrustedRendererAuthority('app://workspace/index.html')
  const renderer = rendererWindow()
  authority.register(renderer.window)

  assert.equal(
    authority.isAuthorized({
      sender: renderer.window.webContents,
      senderFrame: { url: 'app://workspace/index.html' },
    }),
    false
  )
})

test('rejects a registered main frame after it leaves the trusted renderer URL', () => {
  const authority = createTrustedRendererAuthority('app://workspace/index.html')
  const renderer = rendererWindow('https://attacker.example/')
  authority.register(renderer.window)

  assert.equal(authority.isAuthorized({ sender: renderer.window.webContents, senderFrame: renderer.mainFrame }), false)
})

test('broadcasts renderer events only to registered application windows', () => {
  const authority = createTrustedRendererAuthority('app://workspace/index.html')
  const registered = rendererWindow()
  const unexpected = rendererWindow()
  authority.register(registered.window)

  authority.broadcast('session:changed', { revision: 1 })

  assert.deepEqual(registered.sent, [['session:changed', { revision: 1 }]])
  assert.deepEqual(unexpected.sent, [])
})

test('stops authorizing and broadcasting to an unregistered application window', () => {
  const authority = createTrustedRendererAuthority('app://workspace/index.html')
  const renderer = rendererWindow()
  const unregister = authority.register(renderer.window)
  unregister()

  authority.broadcast('session:changed')

  assert.equal(authority.isAuthorized({ sender: renderer.window.webContents, senderFrame: renderer.mainFrame }), false)
  assert.deepEqual(renderer.sent, [])
})
