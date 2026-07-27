import type { ApplicationUpdateRestartOutcome, ApplicationUpdateSnapshot } from '@/src/application-update'
import { compareSemanticVersions, isSemanticVersion } from '@/src/release-notes'

export type ApplicationUpdateSourceEvent =
  | Readonly<{
      type: 'download-progress'
      percent: number
      transferred: number
      total: number
      bytesPerSecond: number
    }>
  | Readonly<{ type: 'downloaded' }>
  | Readonly<{ type: 'error'; message: string }>

export type ApplicationUpdateSource = Readonly<{
  check(): Promise<Readonly<{ version: string; releaseUrl: string }> | undefined>
  download(): Promise<void>
  install(): void
  subscribe(listener: (event: ApplicationUpdateSourceEvent) => void): () => void
}>

type ApplicationUpdaterOptions = Readonly<{
  currentVersion: string
  isPackaged: boolean
  platform: NodeJS.Platform
  source: ApplicationUpdateSource
  hasActiveAgentRun(): boolean
  openExternal(url: string): Promise<void>
}>

export interface ApplicationUpdater {
  getSnapshot(): ApplicationUpdateSnapshot
  check(): Promise<ApplicationUpdateSnapshot>
  download(): Promise<ApplicationUpdateSnapshot>
  restartToUpdate(): ApplicationUpdateRestartOutcome
  openRelease(): Promise<boolean>
  subscribe(listener: (snapshot: ApplicationUpdateSnapshot) => void): () => void
}

function isRailyardReleaseUrl(value: string | undefined): value is string {
  if (!value) return false

  try {
    const url = new URL(value)

    return (
      url.protocol === 'https:' &&
      url.hostname === 'github.com' &&
      url.pathname.startsWith('/pi-workspace/railyard/releases/') &&
      !url.username &&
      !url.password
    )
  } catch {
    return false
  }
}

export function createApplicationUpdater(options: ApplicationUpdaterOptions): ApplicationUpdater {
  const updateMethod = !options.isPackaged ? 'unavailable' : options.platform === 'darwin' ? 'self-install' : 'manual'
  const manualUpdateKind =
    updateMethod !== 'manual'
      ? undefined
      : options.platform === 'win32'
        ? 'windows'
        : options.platform === 'linux'
          ? 'debian'
          : 'unsupported'
  const updateIdentity = {
    currentVersion: options.currentVersion,
    updateMethod,
    manualUpdateKind,
  } as const
  let snapshot: ApplicationUpdateSnapshot = {
    ...updateIdentity,
    status: options.isPackaged ? 'idle' : 'unavailable',
  }
  const listeners = new Set<(snapshot: ApplicationUpdateSnapshot) => void>()

  function publish(nextSnapshot: ApplicationUpdateSnapshot): void {
    snapshot = nextSnapshot

    for (const listener of listeners) listener(snapshot)
  }

  options.source.subscribe((event) => {
    if (event.type === 'download-progress') {
      publish({
        ...snapshot,
        status: 'downloading',
        progress: {
          percent: event.percent,
          transferred: event.transferred,
          total: event.total,
          bytesPerSecond: event.bytesPerSecond,
        },
        error: undefined,
      })
      return
    }

    if (event.type === 'downloaded') {
      publish({ ...snapshot, status: 'ready', progress: undefined, error: undefined })
      return
    }

    publish({ ...snapshot, status: 'error', progress: undefined, error: event.message })
  })

  return {
    getSnapshot: () => snapshot,
    async check() {
      if (!options.isPackaged) return snapshot

      publish({ ...updateIdentity, status: 'checking' })

      try {
        const release = await options.source.check()

        publish(
          release &&
            isSemanticVersion(release.version) &&
            compareSemanticVersions(release.version, options.currentVersion) > 0
            ? {
                ...updateIdentity,
                status: 'available',
                availableVersion: release.version,
                releaseUrl: release.releaseUrl,
              }
            : { ...updateIdentity, status: 'up-to-date' }
        )
      } catch {
        publish({
          ...updateIdentity,
          status: 'error',
          error: 'Railyard could not check for updates. Check your connection and try again.',
        })
      }

      return snapshot
    },
    async download() {
      if (snapshot.status !== 'available' || updateMethod !== 'self-install') return snapshot

      publish({ ...snapshot, status: 'downloading', error: undefined })

      try {
        await options.source.download()
      } catch {
        publish({ ...snapshot, status: 'error', error: 'Railyard could not download the update. Try again.' })
      }

      return snapshot
    },
    restartToUpdate() {
      if (snapshot.status !== 'ready' || updateMethod !== 'self-install') return 'not-ready'
      if (options.hasActiveAgentRun()) return 'blocked-active-run'

      options.source.install()

      return 'restarting'
    },
    async openRelease() {
      if (updateMethod !== 'manual' || !isRailyardReleaseUrl(snapshot.releaseUrl)) return false

      await options.openExternal(snapshot.releaseUrl)

      return true
    },
    subscribe(listener) {
      listeners.add(listener)

      return () => listeners.delete(listener)
    },
  }
}
