export type ApplicationUpdateStatus =
  'unavailable' | 'idle' | 'checking' | 'up-to-date' | 'available' | 'downloading' | 'ready' | 'error'

export type ApplicationUpdateSnapshot = Readonly<{
  currentVersion: string
  updateMethod: 'self-install' | 'manual' | 'unavailable'
  manualUpdateKind?: 'windows' | 'debian' | 'unsupported'
  status: ApplicationUpdateStatus
  availableVersion?: string
  releaseUrl?: string
  progress?: Readonly<{
    percent: number
    transferred: number
    total: number
    bytesPerSecond: number
  }>
  error?: string
}>

export type ApplicationUpdateRestartOutcome = 'restarting' | 'blocked-active-run' | 'not-ready'

export interface ApplicationUpdateBridge {
  getSnapshot(): Promise<ApplicationUpdateSnapshot>
  check(): Promise<ApplicationUpdateSnapshot>
  download(): Promise<ApplicationUpdateSnapshot>
  restartToUpdate(): Promise<ApplicationUpdateRestartOutcome>
  openRelease(): Promise<boolean>
  subscribe(listener: (snapshot: ApplicationUpdateSnapshot) => void): () => void
}
