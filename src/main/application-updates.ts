import { app, net, shell } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { ApplicationUpdateSnapshot } from '@/src/application-update'
import { applicationUpdateIpcChannels, parseApplicationUpdateCommand } from '@/src/application-update-ipc'
import {
  createElectronUpdateSource,
  createGitHubReleaseUpdateSource,
  type ElectronUpdateClient,
} from '@/src/main/application-update-source'
import { createApplicationUpdater } from '@/src/main/application-updater'
import type { PiSessionRuntimeRegistry } from '@/src/main/pi-session-runtimes'
import { broadcastToTrustedRenderers, handleTrustedIpc } from '@/src/main/trusted-ipc'

function electronUpdateClient(): ElectronUpdateClient {
  return {
    get autoDownload() {
      return autoUpdater.autoDownload
    },
    set autoDownload(value) {
      autoUpdater.autoDownload = value
    },
    get autoInstallOnAppQuit() {
      return autoUpdater.autoInstallOnAppQuit
    },
    set autoInstallOnAppQuit(value) {
      autoUpdater.autoInstallOnAppQuit = value
    },
    get allowDowngrade() {
      return autoUpdater.allowDowngrade
    },
    set allowDowngrade(value) {
      autoUpdater.allowDowngrade = value
    },
    get disableWebInstaller() {
      return autoUpdater.disableWebInstaller
    },
    set disableWebInstaller(value) {
      autoUpdater.disableWebInstaller = value
    },
    checkForUpdates: () => autoUpdater.checkForUpdates(),
    downloadUpdate: () => autoUpdater.downloadUpdate(),
    quitAndInstall: (isSilent, isForceRunAfter) => autoUpdater.quitAndInstall(isSilent, isForceRunAfter),
    onProgress: (listener) => {
      autoUpdater.on('download-progress', listener)
    },
    onDownloaded: (listener) => {
      autoUpdater.on('update-downloaded', listener)
    },
    onError: (listener) => {
      autoUpdater.on('error', listener)
    },
  }
}

export function initializeApplicationUpdates(registry: PiSessionRuntimeRegistry): void {
  const source =
    process.platform === 'darwin'
      ? createElectronUpdateSource(electronUpdateClient())
      : createGitHubReleaseUpdateSource((url) =>
          net.fetch(url, {
            headers: {
              Accept: 'application/vnd.github+json',
              'X-GitHub-Api-Version': '2022-11-28',
            },
          })
        )
  const updater = createApplicationUpdater({
    currentVersion: app.getVersion(),
    isPackaged: app.isPackaged,
    platform: process.platform,
    source,
    hasActiveAgentRun: () => registry.getWorkingStateSnapshots().some(({ isWorking }) => isWorking),
    openExternal: (url) => shell.openExternal(url),
  })

  handleTrustedIpc(applicationUpdateIpcChannels.getSnapshot, (): ApplicationUpdateSnapshot => updater.getSnapshot())
  handleTrustedIpc(
    applicationUpdateIpcChannels.command,
    async (_event, value: unknown, ...additionalArguments: unknown[]) => {
      const command = additionalArguments.length === 0 ? parseApplicationUpdateCommand(value) : undefined
      if (!command) throw new TypeError('Unsupported application update command.')

      if (command === 'check') return updater.check()
      if (command === 'download') return updater.download()
      if (command === 'open-release') return updater.openRelease()

      return updater.restartToUpdate()
    }
  )
  updater.subscribe((snapshot) => {
    broadcastToTrustedRenderers(applicationUpdateIpcChannels.changed, snapshot)
  })
}
