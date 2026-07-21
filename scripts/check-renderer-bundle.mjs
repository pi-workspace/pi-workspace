import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

const rendererDirectory = 'dist/renderer'
const initialJavaScriptBudget = 900 * 1024
const totalAssetBudget = 13 * 1024 * 1024

async function filesIn(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await filesIn(path)))
    else files.push(path)
  }

  return files
}

const files = await filesIn(rendererDirectory)
const assets = files.filter((path) => path.includes('/assets/'))
const javascriptAssets = assets.filter((path) => path.endsWith('.js'))
const entry = javascriptAssets.find((path) => /\/index-[^/]+\.js$/.test(path))

if (!entry) throw new Error('Renderer bundle entry was not found.')

const [entrySize, totalAssetSize] = await Promise.all([
  stat(entry).then(({ size }) => size),
  Promise.all(assets.map((path) => stat(path).then(({ size }) => size))).then((sizes) =>
    sizes.reduce((total, size) => total + size, 0)
  ),
])

const formatSize = (size) => `${(size / 1024 / 1024).toFixed(2)} MiB`

console.log(`Renderer initial JavaScript: ${formatSize(entrySize)} (budget ${formatSize(initialJavaScriptBudget)})`)
console.log(`Renderer assets: ${formatSize(totalAssetSize)} (budget ${formatSize(totalAssetBudget)})`)

if (entrySize > initialJavaScriptBudget || totalAssetSize > totalAssetBudget) {
  console.error(
    'Renderer bundle budget exceeded. Update the intentional override in this script and the issue documentation together.'
  )
  process.exitCode = 1
}
