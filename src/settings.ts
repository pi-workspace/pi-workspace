import { isAppearancePreference, type AppearancePreference, type ColorScheme } from '@/src/theme'

export type Settings = Readonly<{
  appearance: AppearancePreference
}>

export type SettingsSnapshot = Settings &
  Readonly<{
    resolvedColorScheme: ColorScheme
    warning?: string
  }>

export type SettingsUpdate = Partial<Settings>

export interface SettingsBridge {
  getSnapshot(): Promise<SettingsSnapshot>
  update(update: SettingsUpdate): Promise<SettingsSnapshot>
  subscribe(listener: (snapshot: SettingsSnapshot) => void): () => void
}

export const defaultSettings: Settings = {
  appearance: 'system',
}

export function parseSettings(value: unknown): Settings | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined
  }

  const settings = value as Record<string, unknown>

  if (Object.keys(settings).length !== 1 || !isAppearancePreference(settings.appearance)) {
    return undefined
  }

  return { appearance: settings.appearance }
}

export function parseSettingsUpdate(value: unknown): SettingsUpdate | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined
  }

  const update = value as Record<string, unknown>

  if (Object.keys(update).length !== 1 || !isAppearancePreference(update.appearance)) {
    return undefined
  }

  return {
    appearance: update.appearance,
  }
}

export function createSettingsSnapshot(
  settings: Settings,
  usesDarkColors: boolean,
  warning?: string
): SettingsSnapshot {
  return {
    ...settings,
    resolvedColorScheme: usesDarkColors ? 'dark' : 'light',
    ...(warning ? { warning } : {}),
  }
}
