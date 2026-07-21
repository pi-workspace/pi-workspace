import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { build as buildRenderer } from 'vite'

const outputDirectory = 'dist'

await rm(outputDirectory, { force: true, recursive: true })
await mkdir(join(outputDirectory, 'main'), { recursive: true })
await mkdir(join(outputDirectory, 'preload'), { recursive: true })
await mkdir(join(outputDirectory, 'renderer'), { recursive: true })

const [mainBuildResult, preloadBuildResult] = await Promise.all([
  Bun.build({
    entrypoints: ['src/main/index.ts'],
    external: ['electron', '@earendil-works/pi-coding-agent'],
    format: 'esm',
    outdir: join(outputDirectory, 'main'),
    target: 'node',
  }),
  Bun.build({
    entrypoints: ['src/preload/index.ts'],
    external: ['electron'],
    format: 'cjs',
    naming: '[name].cjs',
    outdir: join(outputDirectory, 'preload'),
    target: 'node',
  }),
  buildRenderer(),
])

for (const result of [mainBuildResult, preloadBuildResult]) {
  if (!result.success) {
    console.error(result.logs)
    process.exitCode = 1
  }
}

if (mainBuildResult.success && preloadBuildResult.success) {
  await import('./check-renderer-bundle.mjs')
}
