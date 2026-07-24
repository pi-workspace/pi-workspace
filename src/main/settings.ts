import { app, nativeTheme } from 'electron'
import { join } from 'node:path'
import {
  createSettingsSnapshot,
  defaultSettings,
  parseSettings,
  parseSettingsUpdate,
  type Settings,
  type SettingsSnapshot,
  type SettingsUpdate,
} from '@/src/settings'
import { settingsIpcChannels } from '@/src/settings-ipc'
import { readPrivateTextFile, writePrivateTextFile } from '@/src/main/private-storage'
import { broadcastToTrustedRenderers, handleTrustedIpc } from '@/src/main/trusted-ipc'

let settings: Settings = defaultSettings
let settingsWarning: string | undefined
let initialized = false
let lastBroadcastSnapshot: SettingsSnapshot | undefined
const settingsListeners = new Set<(snapshot: SettingsSnapshot) => void>()

const loadWarning =
  'Settings could not be loaded. Default appearance is in use. Fix or remove settings.json, then restart Pi Workspace.'
const migrationWarning = 'Settings could not be updated. The default theme is in use.'
const saveWarning = 'Settings could not be saved. Your appearance change was not applied.'

function getSettingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

async function saveSettings(nextSettings: Settings): Promise<void> {
  await writePrivateTextFile(getSettingsPath(), `${JSON.stringify(nextSettings, null, 2)}\n`)
}

async function loadSettings(): Promise<Readonly<{ settings: Settings; warning?: string }>> {
  try {
    const contents = await readPrivateTextFile(getSettingsPath())
    const savedSettings: unknown = JSON.parse(contents)
    const parsed = parseSettings(savedSettings)

    if (!parsed) {
      console.warn('Saved settings are malformed.')
      return { settings: defaultSettings, warning: loadWarning }
    }

    if (typeof savedSettings === 'object' && savedSettings !== null && !Object.hasOwn(savedSettings, 'theme')) {
      try {
        await saveSettings(parsed)
      } catch (error) {
        console.warn('Unable to update saved settings.', error)
        return { settings: parsed, warning: migrationWarning }
      }
    }

    return { settings: parsed }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('Unable to load saved settings.', error)
      return { settings: defaultSettings, warning: loadWarning }
    }

    try {
      await saveSettings(defaultSettings)
    } catch (saveError) {
      console.warn('Unable to create default settings.', saveError)
      return { settings: defaultSettings, warning: saveWarning }
    }
  }

  return { settings: defaultSettings }
}

function getSnapshot(): SettingsSnapshot {
  return createSettingsSnapshot(settings, nativeTheme.shouldUseDarkColors, settingsWarning)
}

function hasSameSnapshot(first: SettingsSnapshot, second: SettingsSnapshot): boolean {
  return (
    first.appearance === second.appearance &&
    first.theme === second.theme &&
    first.resolvedColorScheme === second.resolvedColorScheme &&
    first.warning === second.warning
  )
}

function broadcastSnapshot(): void {
  const snapshot = getSnapshot()

  if (lastBroadcastSnapshot && hasSameSnapshot(lastBroadcastSnapshot, snapshot)) {
    return
  }

  lastBroadcastSnapshot = snapshot

  broadcastToTrustedRenderers(settingsIpcChannels.changed, snapshot)

  for (const listener of settingsListeners) listener(snapshot)
}

async function updateSettings(update: SettingsUpdate): Promise<SettingsSnapshot> {
  const nextSettings: Settings = {
    ...settings,
    ...update,
  }

  await saveSettings(nextSettings)
  settings = nextSettings
  settingsWarning = undefined
  nativeTheme.themeSource = settings.appearance
  broadcastSnapshot()

  return getSnapshot()
}

export function subscribeToSettings(listener: (snapshot: SettingsSnapshot) => void): () => void {
  settingsListeners.add(listener)

  return () => settingsListeners.delete(listener)
}

export async function initializeSettings(): Promise<SettingsSnapshot> {
  if (initialized) {
    return getSnapshot()
  }

  const loaded = await loadSettings()
  settings = loaded.settings
  settingsWarning = loaded.warning
  nativeTheme.themeSource = settings.appearance

  handleTrustedIpc(settingsIpcChannels.getSnapshot, () => getSnapshot())
  handleTrustedIpc(settingsIpcChannels.update, (_event, update: unknown) => {
    const parsedUpdate = parseSettingsUpdate(update)

    if (!parsedUpdate) {
      throw new TypeError('Unsupported settings update.')
    }

    return updateSettings(parsedUpdate)
  })

  nativeTheme.on('updated', broadcastSnapshot)
  initialized = true

  return getSnapshot()
}
