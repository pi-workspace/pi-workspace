export const appearancePreferences = ['system', 'light', 'dark'] as const

export type AppearancePreference = (typeof appearancePreferences)[number]
export type ColorScheme = Exclude<AppearancePreference, 'system'>

export type Theme = Readonly<{
  id: string
  name: string
  windowBackgroundColor: Readonly<Record<ColorScheme, string>>
}>

export const piWorkspaceTheme = {
  id: 'pi-workspace',
  name: 'Pi Workspace',
  windowBackgroundColor: {
    light: '#ffffff',
    dark: '#18181b',
  },
} as const satisfies Theme

export const oneTheme = {
  id: 'one',
  name: 'One',
  windowBackgroundColor: {
    light: '#fafafa',
    dark: '#282c34',
  },
} as const satisfies Theme

export const themes = [piWorkspaceTheme, oneTheme] as const satisfies readonly Theme[]

// Change this value while theme selection remains a manual development option.
export const activeTheme: Theme = piWorkspaceTheme

export function isAppearancePreference(value: unknown): value is AppearancePreference {
  return appearancePreferences.some((preference) => preference === value)
}
