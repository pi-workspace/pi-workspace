import { compareSemanticVersions, isSemanticVersion } from '@/src/release-notes'
import type { ApplicationUpdateSource } from '@/src/main/application-updater'

const releasesUrl = 'https://api.github.com/repos/pi-workspace/railyard/releases?per_page=20'

type GitHubRelease = Readonly<{
  tag_name: unknown
  draft: unknown
}>

function parseGitHubRelease(value: unknown): Readonly<{ version: string; releaseUrl: string }> | undefined {
  if (!value || typeof value !== 'object') return undefined

  const release = value as GitHubRelease
  const version = typeof release.tag_name === 'string' ? release.tag_name.replace(/^v/, '') : undefined

  if (release.draft !== false || !version || !isSemanticVersion(version)) {
    return undefined
  }

  return {
    version,
    releaseUrl: `https://github.com/pi-workspace/railyard/releases/tag/v${version}`,
  }
}

export interface ElectronUpdateClient {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  allowDowngrade: boolean
  disableWebInstaller: boolean
  checkForUpdates(): Promise<Readonly<{ updateInfo: Readonly<{ version: string }> }> | null>
  downloadUpdate(): Promise<readonly string[]>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
  onProgress(
    listener: (
      progress: Readonly<{ percent: number; transferred: number; total: number; bytesPerSecond: number }>
    ) => void
  ): void
  onDownloaded(listener: () => void): void
  onError(listener: (error: Error) => void): void
}

export function createElectronUpdateSource(client: ElectronUpdateClient): ApplicationUpdateSource {
  client.autoDownload = false
  client.autoInstallOnAppQuit = false
  client.allowDowngrade = false
  client.disableWebInstaller = true

  let listener: Parameters<ApplicationUpdateSource['subscribe']>[0] = () => {}
  client.onProgress((progress) => listener({ type: 'download-progress', ...progress }))
  client.onDownloaded(() => listener({ type: 'downloaded' }))
  client.onError(() =>
    listener({ type: 'error', message: 'Railyard could not complete the update. Check your connection and try again.' })
  )

  return {
    async check() {
      const result = await client.checkForUpdates()
      const version = result?.updateInfo.version

      return version
        ? {
            version,
            releaseUrl: `https://github.com/pi-workspace/railyard/releases/tag/v${version}`,
          }
        : undefined
    },
    async download() {
      await client.downloadUpdate()
    },
    install() {
      client.quitAndInstall(false, true)
    },
    subscribe(nextListener) {
      listener = nextListener

      return () => {
        if (listener === nextListener) listener = () => {}
      }
    },
  }
}

export function createGitHubReleaseUpdateSource(
  fetchRelease: (url: string) => Promise<Response>
): ApplicationUpdateSource {
  return {
    async check() {
      const response = await fetchRelease(releasesUrl)
      if (!response.ok) throw new Error(`GitHub Releases returned ${response.status}.`)

      const value: unknown = await response.json()
      if (!Array.isArray(value)) throw new TypeError('GitHub Releases returned an unsupported response.')

      return value
        .map(parseGitHubRelease)
        .filter((release): release is NonNullable<typeof release> => release !== undefined)
        .sort((first, second) => compareSemanticVersions(second.version, first.version))[0]
    },
    download: async () => {},
    install: () => {},
    subscribe: () => () => {},
  }
}
