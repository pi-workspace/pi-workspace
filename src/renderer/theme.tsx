import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { createSettingsSnapshot, defaultSettings, type SettingsSnapshot } from '@/src/settings'
import { activeTheme, type AppearancePreference } from '@/src/theme'

type ThemeContextValue = SettingsSnapshot &
  Readonly<{
    setAppearance(preference: AppearancePreference): Promise<void>
  }>

type ThemeProviderProperties = Readonly<{
  children: ReactNode
}>

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined)

function getFallbackSnapshot(): SettingsSnapshot {
  return createSettingsSnapshot(defaultSettings, window.matchMedia('(prefers-color-scheme: dark)').matches)
}

export function ThemeProvider({ children }: ThemeProviderProperties) {
  const [snapshot, setSnapshot] = useState<SettingsSnapshot>()

  useEffect(() => {
    let active = true
    const unsubscribe = window.piWorkspace.settings.subscribe((nextSnapshot) => {
      if (active) {
        setSnapshot(nextSnapshot)
      }
    })

    void window.piWorkspace.settings
      .getSnapshot()
      .then((nextSnapshot) => {
        if (active) {
          setSnapshot(nextSnapshot)
        }
      })
      .catch((error: unknown) => {
        console.error('Unable to load settings.', error)
        if (active) {
          setSnapshot(getFallbackSnapshot())
        }
      })

    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  useLayoutEffect(() => {
    if (!snapshot) {
      return
    }

    document.documentElement.dataset.theme = activeTheme.id
    document.documentElement.dataset.colorScheme = snapshot.resolvedColorScheme
  }, [snapshot])

  const setAppearance = useCallback(async (preference: AppearancePreference) => {
    const nextSnapshot = await window.piWorkspace.settings.update({ appearance: preference })
    setSnapshot(nextSnapshot)
  }, [])

  const value = useMemo<ThemeContextValue | undefined>(
    () =>
      snapshot
        ? {
            ...snapshot,
            setAppearance,
          }
        : undefined,
    [setAppearance, snapshot]
  )

  if (!value) {
    return null
  }

  return (
    <ThemeContext value={value}>
      {value.warning ? (
        <div
          className="fixed inset-x-0 top-0 z-50 border-b border-content-border bg-content-background px-4 py-2 text-center text-xs/5 text-form-error-foreground"
          role="alert"
        >
          {value.warning}
        </div>
      ) : null}
      {children}
    </ThemeContext>
  )
}

export function useTheme(): ThemeContextValue {
  const theme = useContext(ThemeContext)

  if (!theme) {
    throw new Error('useTheme must be used within ThemeProvider.')
  }

  return theme
}
