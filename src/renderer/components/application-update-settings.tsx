import { useEffect, useState } from 'react'
import type { ApplicationUpdateSnapshot } from '@/src/application-update'
import { Button } from '@/components/ui-kit/button'

function updateStatusMessage(snapshot: ApplicationUpdateSnapshot): string | undefined {
  if (snapshot.status === 'up-to-date') return 'Railyard is up to date.'
  if (snapshot.status === 'available' && snapshot.availableVersion)
    return `Version ${snapshot.availableVersion} is available.`
  if (snapshot.status === 'ready' && snapshot.availableVersion)
    return `Version ${snapshot.availableVersion} is ready to install.`

  return undefined
}

export function ApplicationUpdateSettings() {
  const [snapshot, setSnapshot] = useState<ApplicationUpdateSnapshot>()
  const [commandPending, setCommandPending] = useState(false)
  const [commandError, setCommandError] = useState<string>()

  useEffect(() => {
    const unsubscribe = window.piWorkspace.applicationUpdate.subscribe(setSnapshot)

    void window.piWorkspace.applicationUpdate.getSnapshot().then(setSnapshot, () => {
      setCommandError('Railyard could not load update information. Close Settings and try again.')
    })

    return unsubscribe
  }, [])

  const runSnapshotCommand = async (command: () => Promise<ApplicationUpdateSnapshot>) => {
    setCommandPending(true)
    setCommandError(undefined)

    try {
      setSnapshot(await command())
    } catch {
      setCommandError('Railyard could not complete the update action. Check your connection and try again.')
    } finally {
      setCommandPending(false)
    }
  }

  const restartToUpdate = async () => {
    setCommandPending(true)
    setCommandError(undefined)

    try {
      const outcome = await window.piWorkspace.applicationUpdate.restartToUpdate()

      if (outcome === 'blocked-active-run') {
        setCommandError('Wait for every Agent Run to finish, then choose Restart to update again.')
      } else if (outcome === 'not-ready') {
        setCommandError('The update is no longer ready. Check for updates again.')
      }
    } catch {
      setCommandError('Railyard could not restart to install the update. Try again.')
    } finally {
      setCommandPending(false)
    }
  }

  const openRelease = async () => {
    setCommandPending(true)
    setCommandError(undefined)

    try {
      if (!(await window.piWorkspace.applicationUpdate.openRelease())) {
        setCommandError('Railyard could not open the GitHub Release. Open GitHub Releases in your browser instead.')
      }
    } catch {
      setCommandError('Railyard could not open the GitHub Release. Open GitHub Releases in your browser instead.')
    } finally {
      setCommandPending(false)
    }
  }

  const statusMessage = snapshot && updateStatusMessage(snapshot)
  const disabled =
    commandPending ||
    !snapshot ||
    snapshot.status === 'unavailable' ||
    snapshot.status === 'checking' ||
    snapshot.status === 'downloading'
  let actionLabel = 'Check for updates'
  let action = () => runSnapshotCommand(() => window.piWorkspace.applicationUpdate.check())

  if (snapshot?.status === 'checking') actionLabel = 'Checking…'
  if (snapshot?.status === 'available' && snapshot.updateMethod === 'self-install') {
    actionLabel = 'Download update'
    action = () => runSnapshotCommand(() => window.piWorkspace.applicationUpdate.download())
  }
  if (snapshot?.status === 'available' && snapshot.updateMethod === 'manual') {
    actionLabel = 'Open GitHub Release'
    action = openRelease
  }
  if (snapshot?.status === 'downloading') actionLabel = 'Downloading…'
  if (snapshot?.status === 'ready') {
    actionLabel = 'Restart to update'
    action = restartToUpdate
  }

  const progress = snapshot?.progress
  const progressPercent = progress ? Math.max(0, Math.min(100, progress.percent)) : undefined

  return (
    <section aria-labelledby="installed-version-heading" className="max-w-xl">
      <div className="rounded-lg border border-content-border bg-content-subtle-background px-5 py-4">
        <h3 id="installed-version-heading" className="text-sm/6 font-medium text-content-foreground">
          Installed version
        </h3>
        <p className="mt-1 font-mono text-sm/6 text-content-muted-foreground">
          {snapshot?.currentVersion ?? 'Loading…'}
        </p>
      </div>

      {statusMessage && (
        <p className="mt-5 text-sm/6 text-content-foreground" role="status">
          {statusMessage}
        </p>
      )}
      {snapshot?.status === 'error' && snapshot.error && (
        <p className="mt-5 text-sm/6 text-form-error-foreground" role="alert">
          {snapshot.error}
        </p>
      )}
      {snapshot?.status === 'available' && snapshot.updateMethod === 'manual' && (
        <div className="mt-5 rounded-lg border border-content-border px-5 py-4 text-sm/6 text-content-muted-foreground">
          {snapshot.manualUpdateKind === 'windows' && (
            <p>
              Download the Windows installer and matching .sha256 file. In PowerShell, compare{' '}
              <code className="font-mono text-content-foreground">Get-FileHash -Algorithm SHA256</code> for the
              installer with the first value in the checksum file, then run the installer yourself.
            </p>
          )}
          {snapshot.manualUpdateKind === 'debian' && (
            <p>
              Download the Debian package and matching .sha256 file. Run{' '}
              <code className="font-mono text-content-foreground">sha256sum --check</code>, then install the verified
              package with <code className="font-mono text-content-foreground">apt</code>.
            </p>
          )}
          {snapshot.manualUpdateKind === 'unsupported' && (
            <p>This platform cannot install updates in Railyard. Download and verify a supported package manually.</p>
          )}
        </div>
      )}
      {progressPercent !== undefined && (
        <div className="mt-5">
          <div className="mb-2 flex justify-between text-xs/5 text-content-muted-foreground">
            <span>Downloading update</span>
            <span>{Math.round(progressPercent)}%</span>
          </div>
          <div
            aria-label="Update download"
            aria-valuemax={100}
            aria-valuemin={0}
            aria-valuenow={Math.round(progressPercent)}
            className="h-2 overflow-hidden rounded-full bg-content-interaction"
            role="progressbar"
          >
            <div className="h-full rounded-full bg-accent" style={{ width: `${progressPercent}%` }} />
          </div>
        </div>
      )}
      {commandError && (
        <p className="mt-5 text-sm/6 text-form-error-foreground" role="alert">
          {commandError}
        </p>
      )}

      <Button className="mt-6" disabled={disabled} onClick={() => void action()}>
        {actionLabel}
      </Button>
      {snapshot?.status === 'unavailable' && (
        <p className="mt-3 text-sm/6 text-content-muted-foreground">
          Update checks are unavailable in development builds.
        </p>
      )}
    </section>
  )
}
