import { app, BrowserWindow, net, protocol, session, shell } from 'electron'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { startApplicationLifecycle, type ApplicationWindow } from '@/src/main/application-lifecycle'
import { initializeApplicationAuthority } from '@/src/main/application-state'
import { initializeApplicationStateIpc } from '@/src/main/application-state-ipc'
import { initializeComposer } from '@/src/main/composer-ipc'
import {
  applicationProtocolScheme,
  allowBrowserPermissionCheck,
  allowBrowserPermissionRequest,
  denyWindowOpen,
  preventUntrustedRendererNavigation,
  productionRendererUrl,
  resolveRendererAssetPath,
  resolveRendererUrl,
} from '@/src/main/renderer-security'
import { createStartupFailureUrl, startupRetryUrl } from '@/src/main/startup-failure'
import { initializeSettings, subscribeToSettings } from '@/src/main/settings'
import { initializeWorkstreams } from '@/src/main/workstreams-ipc'
import { initializeWorkstreamKnowledge } from '@/src/main/workstream-knowledge-ipc'
import { configureTrustedRendererUrl, registerTrustedRendererWindow } from '@/src/main/trusted-ipc'
import { getThemeWindowBackgroundColor } from '@/src/theme'
import { migrateLegacyUserData } from '@/src/main/user-data-migration'

protocol.registerSchemesAsPrivileged([
  {
    scheme: applicationProtocolScheme,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      codeCache: true,
    },
  },
])

const applicationDataDirectory = app.getPath('appData')
const legacyUserDataDirectory = join(applicationDataDirectory, 'Pi Workspace')
const userDataDirectory = join(applicationDataDirectory, 'Railyard')

app.setPath('userData', userDataDirectory)

const rendererDirectory = fileURLToPath(new URL('../renderer/', import.meta.url))
const preloadPath = fileURLToPath(new URL('../preload/index.cjs', import.meta.url))
const applicationIconPath = fileURLToPath(new URL('../../assets/railyard-appicon.png', import.meta.url))
const developmentServerUrl = process.env.VITE_DEV_SERVER_URL
const trustedRendererUrl = resolveRendererUrl({
  isPackaged: app.isPackaged,
  developmentServerUrl,
  productionRendererUrl,
})
configureTrustedRendererUrl(trustedRendererUrl)

let windowBackgroundColor: string = getThemeWindowBackgroundColor('railyard', 'light')
let initializationFailed = false

async function initializeApplication(): Promise<void> {
  protocol.handle(applicationProtocolScheme, (request) => {
    const assetPath = resolveRendererAssetPath(request.url, rendererDirectory)

    if (!assetPath) return new Response(null, { status: 404 })

    return net.fetch(pathToFileURL(assetPath).href)
  })
  session.defaultSession.setPermissionCheckHandler(allowBrowserPermissionCheck)
  session.defaultSession.setPermissionRequestHandler(allowBrowserPermissionRequest)

  try {
    const migration = await migrateLegacyUserData({
      legacyDirectory: legacyUserDataDirectory,
      userDataDirectory,
    })

    if (migration === 'migrated') console.info('Migrated Pi Workspace application data to Railyard.')
    if (migration === 'skipped-existing-user-data') {
      console.warn('Railyard is using existing application data. Pi Workspace application data was not merged.')
    }

    const authority = await initializeApplicationAuthority(app.getPath('userData'))
    initializeApplicationStateIpc(authority)
    initializeWorkstreams(authority, { openPath: (path) => shell.openPath(path) })
    initializeWorkstreamKnowledge(authority)
    const settings = await initializeSettings()
    initializeComposer(authority)
    windowBackgroundColor = getThemeWindowBackgroundColor(settings.theme, settings.resolvedColorScheme)
  } catch (error) {
    initializationFailed = true
    console.error('Railyard initialization failed.', error)
  }

  if (process.platform === 'darwin') {
    app.dock?.setIcon(applicationIconPath)
  }
}

function createWindow(): ApplicationWindow {
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'Railyard',
    icon: applicationIconPath,
    autoHideMenuBar: true,
    backgroundColor: windowBackgroundColor,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadPath,
      sandbox: true,
    },
  })

  const unregisterTrustedRenderer = registerTrustedRendererWindow(window)
  const unsubscribeFromSettings = subscribeToSettings((settings) => {
    window.setBackgroundColor(getThemeWindowBackgroundColor(settings.theme, settings.resolvedColorScheme))
  })
  window.once('closed', () => {
    unregisterTrustedRenderer()
    unsubscribeFromSettings()
  })

  let allowedFailureUrl: string | undefined
  const showFailure = (kind: 'initialization' | 'renderer-load') => {
    allowedFailureUrl = createStartupFailureUrl(kind)
    void window.loadURL(allowedFailureUrl).catch((error: unknown) => {
      console.error('Unable to show the startup recovery screen.', error)
    })
  }
  const preventUntrustedNavigation = (event: Electron.Event, url: string) => {
    if (url === startupRetryUrl) {
      event.preventDefault()
      app.relaunch()
      app.exit(0)
      return
    }

    if (url !== allowedFailureUrl) preventUntrustedRendererNavigation(event, url, trustedRendererUrl)
  }

  window.webContents.on('will-navigate', preventUntrustedNavigation)
  window.webContents.on('will-redirect', preventUntrustedNavigation)
  window.webContents.setWindowOpenHandler(denyWindowOpen)
  window.webContents.on('render-process-gone', () => {
    if (!window.isDestroyed()) showFailure('renderer-load')
  })

  if (initializationFailed) {
    showFailure('initialization')
  } else {
    void window.loadURL(trustedRendererUrl).catch((error: unknown) => {
      console.error('The Railyard renderer failed to load.', error)
      showFailure('renderer-load')
    })
  }

  return {
    isMinimized: () => window.isMinimized(),
    restore: () => window.restore(),
    focus: () => window.focus(),
    onClosed: (listener) => window.once('closed', listener),
  }
}

startApplicationLifecycle({
  platform: process.platform,
  requestSingleInstanceLock: () => app.requestSingleInstanceLock(),
  quit: () => app.quit(),
  whenReady: () => app.whenReady(),
  onSecondInstance: (listener) => app.on('second-instance', listener),
  onActivate: (listener) => app.on('activate', listener),
  onWindowAllClosed: (listener) => app.on('window-all-closed', listener),
  initializeApplication,
  createWindow,
})
