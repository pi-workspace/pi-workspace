import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createApplicationUpdater, type ApplicationUpdateSource } from './application-updater'

function updateSource(overrides: Partial<ApplicationUpdateSource> = {}): ApplicationUpdateSource {
  return {
    check: async () => undefined,
    download: async () => {},
    install: () => {},
    subscribe: () => () => {},
    ...overrides,
  }
}

function availableRelease(version = '2.0.0-beta.2') {
  return {
    version,
    releaseUrl: `https://github.com/pi-workspace/railyard/releases/tag/v${version}`,
  }
}

test('development builds report updates as unavailable without contacting the release source', async () => {
  let checkCount = 0
  const updater = createApplicationUpdater({
    currentVersion: '2.0.0-beta.1',
    isPackaged: false,
    platform: 'darwin',
    source: updateSource({
      check: async () => {
        checkCount += 1
        return undefined
      },
    }),
    hasActiveAgentRun: () => false,
    openExternal: async () => {},
  })

  const snapshot = await updater.check()

  assert.equal(snapshot.status, 'unavailable')
  assert.equal(checkCount, 0)
})

test('a packaged build reports a newer semantic release as available', async () => {
  const updater = createApplicationUpdater({
    currentVersion: '2.0.0-beta.1',
    isPackaged: true,
    platform: 'darwin',
    source: updateSource({
      check: async () => availableRelease(),
    }),
    hasActiveAgentRun: () => false,
    openExternal: async () => {},
  })

  const snapshot = await updater.check()

  assert.equal(snapshot.status, 'available')
  assert.equal(snapshot.availableVersion, '2.0.0-beta.2')
})

test('a packaged build never offers an older release', async () => {
  const updater = createApplicationUpdater({
    currentVersion: '2.0.0-beta.2',
    isPackaged: true,
    platform: 'darwin',
    source: updateSource({
      check: async () => ({
        version: '2.0.0-beta.1',
        releaseUrl: 'https://github.com/pi-workspace/railyard/releases/tag/v2.0.0-beta.1',
      }),
    }),
    hasActiveAgentRun: () => false,
    openExternal: async () => {},
  })

  const snapshot = await updater.check()

  assert.equal(snapshot.status, 'up-to-date')
})

test('macOS download progress ends in an update-ready state', async () => {
  let notify: Parameters<ApplicationUpdateSource['subscribe']>[0] = () => {}
  const updater = createApplicationUpdater({
    currentVersion: '2.0.0-beta.1',
    isPackaged: true,
    platform: 'darwin',
    source: updateSource({
      check: async () => availableRelease(),
      download: async () => {
        notify({
          type: 'download-progress',
          percent: 42,
          transferred: 420,
          total: 1_000,
          bytesPerSecond: 100,
        })
        notify({ type: 'downloaded' })
      },
      subscribe: (listener) => {
        notify = listener
        return () => {}
      },
    }),
    hasActiveAgentRun: () => false,
    openExternal: async () => {},
  })

  await updater.check()
  const snapshot = await updater.download()

  assert.equal(snapshot.status, 'ready')
})

test('macOS download progress is published to update subscribers', async () => {
  let notify: Parameters<ApplicationUpdateSource['subscribe']>[0] = () => {}
  const observedPercentages: number[] = []
  const updater = createApplicationUpdater({
    currentVersion: '2.0.0-beta.1',
    isPackaged: true,
    platform: 'darwin',
    source: updateSource({
      check: async () => availableRelease(),
      download: async () => {
        notify({
          type: 'download-progress',
          percent: 42,
          transferred: 420,
          total: 1_000,
          bytesPerSecond: 100,
        })
      },
      subscribe: (listener) => {
        notify = listener
        return () => {}
      },
    }),
    hasActiveAgentRun: () => false,
    openExternal: async () => {},
  })
  updater.subscribe((snapshot) => {
    if (snapshot.progress) observedPercentages.push(snapshot.progress.percent)
  })

  await updater.check()
  await updater.download()

  assert.deepEqual(observedPercentages, [42])
})

test('a ready macOS update does not restart while an Agent Run is active', async () => {
  let notify: Parameters<ApplicationUpdateSource['subscribe']>[0] = () => {}
  let installCount = 0
  const updater = createApplicationUpdater({
    currentVersion: '2.0.0-beta.1',
    isPackaged: true,
    platform: 'darwin',
    source: updateSource({
      check: async () => availableRelease(),
      download: async () => notify({ type: 'downloaded' }),
      install: () => {
        installCount += 1
      },
      subscribe: (listener) => {
        notify = listener
        return () => {}
      },
    }),
    hasActiveAgentRun: () => true,
    openExternal: async () => {},
  })

  await updater.check()
  await updater.download()
  const outcome = updater.restartToUpdate()

  assert.equal(outcome, 'blocked-active-run')
  assert.equal(installCount, 0)
})

test('a ready macOS update installs only through the explicit restart command', async () => {
  let notify: Parameters<ApplicationUpdateSource['subscribe']>[0] = () => {}
  let installCount = 0
  const updater = createApplicationUpdater({
    currentVersion: '2.0.0-beta.1',
    isPackaged: true,
    platform: 'darwin',
    source: updateSource({
      check: async () => availableRelease(),
      download: async () => notify({ type: 'downloaded' }),
      install: () => {
        installCount += 1
      },
      subscribe: (listener) => {
        notify = listener
        return () => {}
      },
    }),
    hasActiveAgentRun: () => false,
    openExternal: async () => {},
  })

  await updater.check()
  await updater.download()
  const outcome = updater.restartToUpdate()

  assert.equal(outcome, 'restarting')
  assert.equal(installCount, 1)
})

test('manual-update platforms open the matching GitHub Release instead of downloading it', async () => {
  let downloadCount = 0
  const openedUrls: string[] = []
  const updater = createApplicationUpdater({
    currentVersion: '2.0.0-beta.1',
    isPackaged: true,
    platform: 'linux',
    source: updateSource({
      check: async () => availableRelease(),
      download: async () => {
        downloadCount += 1
      },
    }),
    hasActiveAgentRun: () => false,
    openExternal: async (url) => {
      openedUrls.push(url)
    },
  })

  await updater.check()
  await updater.download()
  const opened = await updater.openRelease()

  assert.equal(opened, true)
  assert.equal(updater.getSnapshot().manualUpdateKind, 'debian')
  assert.equal(downloadCount, 0)
  assert.deepEqual(openedUrls, ['https://github.com/pi-workspace/railyard/releases/tag/v2.0.0-beta.2'])
})
