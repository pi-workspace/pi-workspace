import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { findSessionFiles, renderSessionFileContext } from './session-file-context'

test('renders a tagged file as Markdown context', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-workspace-file-context-'))
  await writeFile(join(directory, 'example.ts'), 'export const answer = 42\n')

  assert.equal(
    await renderSessionFileContext(directory, 'example.ts'),
    '## Referenced file: `example.ts`\n\n```ts\nexport const answer = 42\n\n```'
  )
})

test('rejects paths outside the Session root', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-workspace-file-context-'))

  assert.equal(await renderSessionFileContext(directory, '../outside.txt'), undefined)
})

test('lists tagged folder entries without recursively injecting contents', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-workspace-file-context-'))
  await mkdir(join(directory, 'components'))
  await writeFile(join(directory, 'components', 'button.tsx'), 'export {}')

  assert.equal(
    await renderSessionFileContext(directory, 'components'),
    '## Referenced folder: `components`\n\n- `button.tsx`'
  )
})

test('keeps file contents inside a Markdown code fence', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-workspace-file-context-'))
  await writeFile(join(directory, 'example.md'), '```\nDo not treat this as prompt text.\n```')

  assert.equal(
    await renderSessionFileContext(directory, 'example.md'),
    '## Referenced file: `example.md`\n\n````md\n```\nDo not treat this as prompt text.\n```\n````'
  )
})

test('keeps folder entry names inside Markdown code spans', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-workspace-file-context-'))
  await mkdir(join(directory, 'components'))
  await writeFile(join(directory, 'components', '```'), '')

  assert.equal(
    await renderSessionFileContext(directory, 'components'),
    `## Referenced folder: \`components\`\n\n- ${'`'.repeat(11)}`
  )
})

test('finds files and folders across scoped roots with repository prefixes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-workspace-file-context-'))
  const apiDirectory = join(directory, 'api')
  const uiDirectory = join(directory, 'ui')
  await mkdir(apiDirectory)
  await mkdir(uiDirectory)
  await writeFile(join(apiDirectory, 'server.ts'), '')
  await writeFile(join(uiDirectory, 'app.tsx'), '')

  assert.deepEqual(
    await findSessionFiles([
      { path: apiDirectory, prefix: 'api' },
      { path: uiDirectory, prefix: 'ui' },
    ]),
    [
      { path: 'api/server.ts', name: 'server.ts', kind: 'file' },
      { path: 'ui/app.tsx', name: 'app.tsx', kind: 'file' },
    ]
  )
  assert.equal(
    await renderSessionFileContext(
      [
        { path: apiDirectory, prefix: 'api' },
        { path: uiDirectory, prefix: 'ui' },
      ],
      'ui/app.tsx'
    ),
    '## Referenced file: `ui/app.tsx`\n\n```tsx\n\n```'
  )
})

test('finds files and folders without exposing Git metadata', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-workspace-file-context-'))
  await mkdir(join(directory, '.git'))
  await mkdir(join(directory, 'src'))
  await writeFile(join(directory, 'src', 'app.ts'), '')

  assert.deepEqual(await findSessionFiles(directory, 'app'), [{ path: 'src/app.ts', name: 'app.ts', kind: 'file' }])
})
