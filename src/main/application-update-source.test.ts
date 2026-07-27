import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  createElectronUpdateSource,
  createGitHubReleaseUpdateSource,
  type ElectronUpdateClient,
} from './application-update-source'

test('the manual update source selects the newest published semantic release', async () => {
  const source = createGitHubReleaseUpdateSource(async () =>
    Response.json([
      {
        tag_name: 'v2.0.0-beta.2',
        html_url: 'https://github.com/pi-workspace/railyard/releases/tag/v2.0.0-beta.2',
        draft: false,
      },
      {
        tag_name: 'v2.0.0-beta.3',
        html_url: 'https://github.com/pi-workspace/railyard/releases/tag/v2.0.0-beta.3',
        draft: true,
      },
      {
        tag_name: 'v2.0.0-beta.1',
        html_url: 'https://github.com/pi-workspace/railyard/releases/tag/v2.0.0-beta.1',
        draft: false,
      },
    ])
  )

  const release = await source.check()

  assert.deepEqual(release, {
    version: '2.0.0-beta.2',
    releaseUrl: 'https://github.com/pi-workspace/railyard/releases/tag/v2.0.0-beta.2',
  })
})

test('the macOS update source disables automatic download, quit installation, and downgrades', async () => {
  const client: ElectronUpdateClient = {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    allowDowngrade: true,
    disableWebInstaller: false,
    checkForUpdates: async () => ({ updateInfo: { version: '2.0.0-beta.2' } }),
    downloadUpdate: async () => [],
    quitAndInstall: () => {},
    onProgress: () => {},
    onDownloaded: () => {},
    onError: () => {},
  }

  const source = createElectronUpdateSource(client)
  const release = await source.check()

  assert.equal(client.autoDownload, false)
  assert.equal(client.autoInstallOnAppQuit, false)
  assert.equal(client.allowDowngrade, false)
  assert.equal(client.disableWebInstaller, true)
  assert.deepEqual(release, {
    version: '2.0.0-beta.2',
    releaseUrl: 'https://github.com/pi-workspace/railyard/releases/tag/v2.0.0-beta.2',
  })
})
