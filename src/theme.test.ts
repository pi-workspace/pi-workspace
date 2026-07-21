import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { activeTheme, oneTheme, piWorkspaceTheme, themes } from './theme'

test('uses Pi Workspace as the active theme', () => {
  assert.equal(activeTheme, piWorkspaceTheme)
})

test('provides unique theme identifiers', () => {
  assert.equal(new Set(themes.map((theme) => theme.id)).size, themes.length)
})

test('provides a window background for every theme color scheme', () => {
  for (const theme of themes) {
    assert.match(theme.windowBackgroundColor.light, /^#[\da-f]{6}$/i)
    assert.match(theme.windowBackgroundColor.dark, /^#[\da-f]{6}$/i)
  }
})

test('pairs One Light and One Dark under one theme', () => {
  assert.equal(oneTheme.name, 'One')
  assert.equal(oneTheme.windowBackgroundColor.light, '#fafafa')
  assert.equal(oneTheme.windowBackgroundColor.dark, '#282c34')
})

test('keeps Pi Workspace window backgrounds neutral', () => {
  assert.equal(piWorkspaceTheme.windowBackgroundColor.light, '#ffffff')
  assert.equal(piWorkspaceTheme.windowBackgroundColor.dark, '#18181b')
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
