import {
  isAppearancePreference,
  isThemeId,
  resolveThemeColorScheme,
  type AppearancePreference,
  type ColorScheme,
  type ThemeId,
} from '@/src/theme'

export type Settings = Readonly<{
  appearance: AppearancePreference
  theme: ThemeId
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
  theme: 'pi-workspace',
}

export function parseSettings(value: unknown): Settings | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined
  }

  const settings = value as Record<string, unknown>

  const hasTheme = Object.hasOwn(settings, 'theme')

  if (
    Object.keys(settings).length !== (hasTheme ? 2 : 1) ||
    !isAppearancePreference(settings.appearance) ||
    (hasTheme && !isThemeId(settings.theme))
  ) {
    return undefined
  }

  const theme = isThemeId(settings.theme) ? settings.theme : defaultSettings.theme

  return { appearance: settings.appearance, theme }
}

export function parseSettingsUpdate(value: unknown): SettingsUpdate | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined
  }

  const update = value as Record<string, unknown>

  if (Object.keys(update).length !== 1) return undefined

  if (isAppearancePreference(update.appearance)) return { appearance: update.appearance }
  if (isThemeId(update.theme)) return { theme: update.theme }

  return undefined
}

export function createSettingsSnapshot(
  settings: Settings,
  usesDarkColors: boolean,
  warning?: string
): SettingsSnapshot {
  return {
    ...settings,
    resolvedColorScheme: resolveThemeColorScheme(settings.theme, usesDarkColors),
    ...(warning ? { warning } : {}),
  }
}
