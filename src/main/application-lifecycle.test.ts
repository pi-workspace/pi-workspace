import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  startApplicationLifecycle,
  type ApplicationLifecycleOptions,
  type ApplicationWindow,
} from './application-lifecycle'

function applicationWindow(): ApplicationWindow {
  return {
    isMinimized: () => false,
    restore: () => {},
    focus: () => {},
    onClosed: () => {},
  }
}

async function settleLifecycle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

function lifecycleOptions(overrides: Partial<ApplicationLifecycleOptions> = {}): ApplicationLifecycleOptions {
  return {
    platform: 'linux',
    requestSingleInstanceLock: () => true,
    quit: () => {},
    whenReady: () => Promise.resolve(),
    onSecondInstance: () => {},
    onActivate: () => {},
    onWindowAllClosed: () => {},
    initializeApplication: () => Promise.resolve(),
    createWindow: () => {
      throw new Error('Unexpected window creation.')
    },
    ...overrides,
  }
}

test('a secondary application process quits before initializing application authority', () => {
  let quitCount = 0
  let initializationCount = 0

  const primary = startApplicationLifecycle(
    lifecycleOptions({
      requestSingleInstanceLock: () => false,
      quit: () => {
        quitCount += 1
      },
      initializeApplication: () => {
        initializationCount += 1
        return Promise.resolve()
      },
    })
  )

  assert.equal(primary, false)
  assert.equal(quitCount, 1)
  assert.equal(initializationCount, 0)
})

test('the primary process initializes application authority and creates a window once', async () => {
  let initializationCount = 0
  let windowCount = 0

  const primary = startApplicationLifecycle(
    lifecycleOptions({
      initializeApplication: () => {
        initializationCount += 1
        return Promise.resolve()
      },
      createWindow: () => {
        windowCount += 1
        return applicationWindow()
      },
    })
  )
  await settleLifecycle()

  assert.equal(primary, true)
  assert.equal(initializationCount, 1)
  assert.equal(windowCount, 1)
})

test('a second launch restores and focuses the primary window without reinitializing', async () => {
  let secondInstance: (() => void) | undefined
  let initializationCount = 0
  let restoreCount = 0
  let focusCount = 0

  startApplicationLifecycle(
    lifecycleOptions({
      onSecondInstance: (listener) => {
        secondInstance = listener
      },
      initializeApplication: () => {
        initializationCount += 1
        return Promise.resolve()
      },
      createWindow: () => ({
        isMinimized: () => true,
        restore: () => {
          restoreCount += 1
        },
        focus: () => {
          focusCount += 1
        },
        onClosed: () => {},
      }),
    })
  )
  await settleLifecycle()

  secondInstance?.()
  await settleLifecycle()

  assert.equal(initializationCount, 1)
  assert.equal(restoreCount, 1)
  assert.equal(focusCount, 1)
})

test('macOS activation reopens a window with the existing application authority', async () => {
  let activate: (() => void) | undefined
  let closeWindow: (() => void) | undefined
  let initializationCount = 0
  let windowCount = 0

  startApplicationLifecycle(
    lifecycleOptions({
      platform: 'darwin',
      onActivate: (listener) => {
        activate = listener
      },
      initializeApplication: () => {
        initializationCount += 1
        return Promise.resolve()
      },
      createWindow: () => {
        windowCount += 1

        return {
          ...applicationWindow(),
          onClosed: (listener) => {
            closeWindow = listener
          },
        }
      },
    })
  )
  await settleLifecycle()

  closeWindow?.()
  activate?.()
  await settleLifecycle()

  assert.equal(initializationCount, 1)
  assert.equal(windowCount, 2)
})

test('closing every window quits the primary process outside macOS', async () => {
  let windowAllClosed: (() => void) | undefined
  let quitCount = 0

  startApplicationLifecycle(
    lifecycleOptions({
      onWindowAllClosed: (listener) => {
        windowAllClosed = listener
      },
      quit: () => {
        quitCount += 1
      },
      createWindow: applicationWindow,
    })
  )
  await settleLifecycle()

  windowAllClosed?.()

  assert.equal(quitCount, 1)
})
