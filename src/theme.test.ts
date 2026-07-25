import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import {
  draculaTheme,
  getTheme,
  getThemeWindowBackgroundColor,
  githubTheme,
  nightOwlTheme,
  oneTheme,
  railyardTheme,
  resolveThemeColorScheme,
  themes,
  tokyoNightTheme,
} from './theme'

test('looks up each selectable theme by its identifier', () => {
  assert.equal(getTheme('railyard'), railyardTheme)
  assert.equal(getTheme('one'), oneTheme)
  assert.equal(getTheme('github'), githubTheme)
  assert.equal(getTheme('dracula'), draculaTheme)
  assert.equal(getTheme('night-owl'), nightOwlTheme)
  assert.equal(getTheme('tokyo-night'), tokyoNightTheme)
})

test('provides unique theme identifiers', () => {
  assert.equal(new Set(themes.map((theme) => theme.id)).size, themes.length)
})

test('provides a window background for every supported theme color scheme', () => {
  for (const theme of themes) {
    for (const colorScheme of theme.colorSchemes) {
      assert.match(getThemeWindowBackgroundColor(theme.id, colorScheme), /^#[\da-f]{6}$/i)
    }
  }
})

test('resolves dark-only themes to dark mode without changing the saved appearance preference', () => {
  assert.equal(resolveThemeColorScheme('dracula', false), 'dark')
  assert.equal(resolveThemeColorScheme('dracula', true), 'dark')
})

test('pairs One Light and One Dark under one theme', () => {
  assert.equal(oneTheme.name, 'One')
  assert.equal(oneTheme.windowBackgroundColor.light, '#fafafa')
  assert.equal(oneTheme.windowBackgroundColor.dark, '#282c34')
})

test('uses Railyard paper and ink window backgrounds', () => {
  assert.equal(railyardTheme.windowBackgroundColor.light, '#efece4')
  assert.equal(railyardTheme.windowBackgroundColor.dark, '#141210')
})

test('new themes provide a caution color for context usage', () => {
  const stylesheet = readFileSync(join(process.cwd(), 'src', 'renderer', 'style.css'), 'utf8')

  assert.match(
    stylesheet,
    /:root:is\(\[data-theme='github'\], \[data-theme='dracula'\], \[data-theme='night-owl'\], \[data-theme='tokyo-night'\]\) \{[\s\S]*--theme-warning-border:/
  )
})

test('renderer components use semantic theme colors', () => {
  const componentDirectories = [join(process.cwd(), 'components', 'ui-kit'), join(process.cwd(), 'src', 'renderer')]
  const paletteUtility =
    /(?:bg|border(?:-[blrtxy])?|decoration|fill|outline|ring|shadow|stroke|text)-(?:black|blue|cyan|emerald|fuchsia|gray|green|indigo|lime|neutral|orange|pink|purple|red|rose|sky|slate|stone|teal|violet|white|yellow|zinc)(?:-|\/|\b)/

  for (const directory of componentDirectories) {
    const pendingDirectories = [directory]

    while (pendingDirectories.length > 0) {
      const currentDirectory = pendingDirectories.pop()
      if (!currentDirectory) continue

      for (const entry of readdirSync(currentDirectory, { withFileTypes: true })) {
        const path = join(currentDirectory, entry.name)

        if (entry.isDirectory()) {
          pendingDirectories.push(path)
        } else if (entry.name.endsWith('.tsx')) {
          assert.doesNotMatch(readFileSync(path, 'utf8'), paletteUtility, path)
        }
      }
    }
  }
})
