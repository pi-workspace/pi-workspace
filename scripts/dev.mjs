import chokidar from 'chokidar'
import { createRequire } from 'node:module'
import { createServer } from 'vite'

const rootDirectory = process.cwd()
const require = createRequire(import.meta.url)
const electronExecutable = require('electron')

let electronProcess
let rebuildInProgress = false
let rebuildTimer
let shuttingDown = false
let rendererServer
let rendererUrl

async function buildElectronProcesses() {
  const results = await Promise.all([
    Bun.build({
      entrypoints: ['src/main/index.ts'],
      external: ['electron', '@earendil-works/pi-coding-agent'],
      format: 'esm',
      outdir: 'dist/main',
      target: 'node',
    }),
    Bun.build({
      entrypoints: ['src/preload/index.ts'],
      external: ['electron'],
      format: 'cjs',
      naming: '[name].cjs',
      outdir: 'dist/preload',
      target: 'node',
    }),
  ])

  for (const result of results) {
    if (!result.success) {
      console.error(result.logs)
    }
  }

  return results.every((result) => result.success)
}

async function stopElectron() {
  if (!electronProcess) {
    return
  }

  const runningProcess = electronProcess
  electronProcess = undefined
  runningProcess.kill()
  await runningProcess.exited
}

function startElectron() {
  const nextElectronProcess = Bun.spawn({
    cmd: [electronExecutable, '.'],
    cwd: rootDirectory,
    env: { ...process.env, VITE_DEV_SERVER_URL: rendererUrl },
    stdout: 'inherit',
    stderr: 'inherit',
  })
  electronProcess = nextElectronProcess

  void nextElectronProcess.exited.then((exitCode) => {
    if (electronProcess === nextElectronProcess) {
      electronProcess = undefined
      if (exitCode !== 0 && !shuttingDown) {
        console.error(`Electron exited with code ${exitCode}. Waiting for the next main-process change.`)
      }
    }
  })
}

async function rebuildAndRestartMain() {
  if (rebuildInProgress) {
    return
  }

  rebuildInProgress = true
  console.log('\nBuilding Electron processes…')

  if (await buildElectronProcesses()) {
    await stopElectron()
    startElectron()
  } else {
    console.error('Main-process build failed. Keeping the current Electron window open.')
  }

  rebuildInProgress = false
}

function scheduleMainRestart() {
  clearTimeout(rebuildTimer)
  rebuildTimer = setTimeout(() => {
    void rebuildAndRestartMain()
  }, 100)
}

const watcher = chokidar.watch(['src/main', 'src/preload', 'src/theme.ts', 'src/theme-ipc.ts'], {
  cwd: rootDirectory,
  ignoreInitial: true,
})

watcher.on('all', (event, path) => {
  console.log(`${event}: ${path}; restarting Electron main process…`)
  scheduleMainRestart()
})

watcher.on('error', (error) => {
  console.error('Main-process watcher failed:', error)
})

async function shutdown(signal) {
  if (shuttingDown) {
    return
  }

  shuttingDown = true
  console.log(`\nReceived ${signal}; stopping development mode.`)
  clearTimeout(rebuildTimer)
  await watcher.close()
  await rendererServer?.close()
  await stopElectron()
  process.exit(0)
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    void shutdown(signal)
  })
}

rendererServer = await createServer()
await rendererServer.listen()
rendererUrl = rendererServer.resolvedUrls?.local[0]

if (!rendererUrl) {
  throw new Error('Vite did not provide a local development URL.')
}

console.log(`Renderer HMR available at ${rendererUrl}`)
void rebuildAndRestartMain()
