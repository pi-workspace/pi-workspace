import assert from 'node:assert/strict'
import { access, readdir, readFile } from 'node:fs/promises'
import { extname, join, relative } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))
const productionRoots = [join(repositoryRoot, 'src'), join(repositoryRoot, 'components')]

async function productionSourceFiles(directory: string): Promise<readonly string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name)

      if (entry.isDirectory()) return productionSourceFiles(path)
      if (entry.name.includes('.test.') || entry.name.includes('.spec.')) return []

      return ['.ts', '.tsx'].includes(extname(entry.name)) ? [path] : []
    })
  )

  return files.flat()
}

async function allProductionSourceFiles(): Promise<readonly string[]> {
  return (await Promise.all(productionRoots.map(productionSourceFiles))).flat()
}

async function productionStringLiterals(): Promise<readonly Readonly<{ path: string; value: string }>[]> {
  const values: Readonly<{ path: string; value: string }>[] = []

  for (const path of await allProductionSourceFiles()) {
    const source = await readFile(path, 'utf8')
    const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true)

    function visit(node: ts.Node) {
      if (ts.isStringLiteralLike(node)) values.push({ path, value: node.text })
      ts.forEachChild(node, visit)
    }

    visit(sourceFile)
  }

  return values
}

test('retired Project authority module paths remain absent', async () => {
  const retiredModules = [
    'src/domain/project.ts',
    'src/projects.ts',
    'src/projects-ipc.ts',
    'src/main/projects.ts',
    'src/main/projects-ipc.ts',
    'src/main/show-project-registration-error.ts',
    'src/main/pi-project-session.ts',
    'src/main/pi-sessions.ts',
    'src/main/pi-session-creation.ts',
    'src/main/pi-session-catalog.ts',
    'src/renderer/components/project-session-tree.tsx',
  ]

  for (const modulePath of retiredModules) {
    await assert.rejects(access(join(repositoryRoot, modulePath)), { code: 'ENOENT' })
  }
})

test('production sources do not define retired Project IPC channels', async () => {
  const violation = (await productionStringLiterals()).find(({ value }) => value.startsWith('projects:'))

  assert.equal(violation && relative(repositoryRoot, violation.path), undefined)
})

test('production sources do not read the retired projects.json authority', async () => {
  const violation = (await productionStringLiterals()).find(({ value }) => value.includes('projects.json'))

  assert.equal(violation && relative(repositoryRoot, violation.path), undefined)
})

test('production sources do not depend on prototype artifacts', async () => {
  const violation = (await productionStringLiterals()).find(({ value }) => value.split(/[\\/]/).includes('prototypes'))

  assert.equal(violation && relative(repositoryRoot, violation.path), undefined)
})

test('production copy does not use the historical Wayfinder prototype name', async () => {
  const violation = (await productionStringLiterals()).find(({ value }) => /wayfinder/i.test(value))

  assert.equal(violation && relative(repositoryRoot, violation.path), undefined)
})

test('retired managed Repository scope lifecycle does not return', async () => {
  const retiredScopeTerms = [
    'proposal-needed',
    'pending-scope',
    'repository-scope',
    'scope revision',
    'effective scope',
    'confirmed scope',
    'provisioning',
  ]
  const violation = (await productionStringLiterals()).find(({ value }) =>
    retiredScopeTerms.some((term) => value.toLowerCase().includes(term))
  )

  assert.equal(violation && relative(repositoryRoot, violation.path), undefined)
})
