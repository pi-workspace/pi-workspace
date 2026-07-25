export const appearancePreferences = ['system', 'light', 'dark'] as const

export type AppearancePreference = (typeof appearancePreferences)[number]
export type ColorScheme = Exclude<AppearancePreference, 'system'>

export const themeIds = ['railyard', 'one', 'github', 'dracula', 'night-owl', 'tokyo-night'] as const
export type ThemeId = (typeof themeIds)[number]

export type Theme = Readonly<{
  id: ThemeId
  name: string
  colorSchemes: readonly ColorScheme[]
  windowBackgroundColor: Readonly<Partial<Record<ColorScheme, string>>>
}>

export const railyardTheme = {
  id: 'railyard',
  name: 'Railyard',
  colorSchemes: ['light', 'dark'],
  windowBackgroundColor: {
    light: '#efece4',
    dark: '#141210',
  },
} as const satisfies Theme

export const oneTheme = {
  id: 'one',
  name: 'One',
  colorSchemes: ['light', 'dark'],
  windowBackgroundColor: {
    light: '#fafafa',
    dark: '#282c34',
  },
} as const satisfies Theme

export const githubTheme = {
  id: 'github',
  name: 'GitHub',
  colorSchemes: ['light', 'dark'],
  windowBackgroundColor: {
    light: '#ffffff',
    dark: '#0d1117',
  },
} as const satisfies Theme

export const draculaTheme = {
  id: 'dracula',
  name: 'Dracula',
  colorSchemes: ['dark'],
  windowBackgroundColor: {
    dark: '#282a36',
  },
} as const satisfies Theme

export const nightOwlTheme = {
  id: 'night-owl',
  name: 'Night Owl',
  colorSchemes: ['dark'],
  windowBackgroundColor: {
    dark: '#011627',
  },
} as const satisfies Theme

export const tokyoNightTheme = {
  id: 'tokyo-night',
  name: 'Tokyo Night',
  colorSchemes: ['dark'],
  windowBackgroundColor: {
    dark: '#1a1b26',
  },
} as const satisfies Theme

export const themes = [
  railyardTheme,
  oneTheme,
  githubTheme,
  draculaTheme,
  nightOwlTheme,
  tokyoNightTheme,
] as const satisfies readonly Theme[]

export function isThemeId(value: unknown): value is ThemeId {
  return themeIds.some((themeId) => themeId === value)
}

export function normalizeThemeId(value: unknown): ThemeId | undefined {
  if (isThemeId(value)) return value
  if (value === 'pi-workspace') return 'railyard'

  return undefined
}

export function getTheme(themeId: ThemeId): Theme {
  return themes.find((theme) => theme.id === themeId)!
}

export function resolveThemeColorScheme(themeId: ThemeId, usesDarkColors: boolean): ColorScheme {
  const requestedColorScheme: ColorScheme = usesDarkColors ? 'dark' : 'light'
  const theme = getTheme(themeId)

  return theme.colorSchemes.includes(requestedColorScheme) ? requestedColorScheme : theme.colorSchemes[0]!
}

export function getThemeWindowBackgroundColor(themeId: ThemeId, colorScheme: ColorScheme): string {
  const backgroundColor = getTheme(themeId).windowBackgroundColor[colorScheme]

  if (!backgroundColor) throw new Error(`Theme ${themeId} does not support ${colorScheme} mode.`)

  return backgroundColor
}

export function isAppearancePreference(value: unknown): value is AppearancePreference {
  return appearancePreferences.some((preference) => preference === value)
}
