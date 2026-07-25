import { useState } from 'react'
import { AlertTriangle, Archive, RotateCcw } from 'lucide-react'
import type { ApplicationStateStartup } from '@/src/application-state'
import { Button } from '@/components/ui-kit/button'
import { Dialog, DialogActions, DialogBody, DialogTitle } from '@/components/ui-kit/dialog'
import { Input } from '@/components/ui-kit/input'

type RecoveryScreenProperties = Readonly<{
  startup: Extract<ApplicationStateStartup, { status: 'recovery-only' }>
  onReset(): Promise<void>
}>

export function RecoveryScreen({ startup, onReset }: RecoveryScreenProperties) {
  const [confirmation, setConfirmation] = useState('')
  const [resetOpen, setResetOpen] = useState(false)
  const [backupMessage, setBackupMessage] = useState<string>()
  const [error, setError] = useState<string>()

  const createBackup = async () => {
    try {
      const path = await window.piWorkspace.applicationState.createBackup()
      setBackupMessage(`Backup created at ${path}.`)
    } catch (backupError) {
      setError(backupError instanceof Error ? backupError.message : 'Could not create a backup.')
    }
  }

  const reset = async () => {
    try {
      await window.piWorkspace.applicationState.reset(confirmation)
      await onReset()
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : 'Could not reset application state.')
    }
  }

  return (
    <main className="flex min-h-full flex-1 items-center justify-center bg-page-background px-6 py-12">
      <section
        aria-labelledby="recovery-title"
        className="w-full max-w-xl rounded-xl border border-content-border bg-content-background p-8 shadow-sm"
      >
        <AlertTriangle aria-hidden="true" className="size-8 text-activity-blocked" />
        <p className="mt-5 text-sm font-medium text-activity-blocked">Recovery required</p>
        <h1 id="recovery-title" className="mt-2 text-2xl font-semibold tracking-tight text-content-foreground">
          Railyard could not open its application state
        </h1>
        <p className="mt-3 text-sm/6 text-content-muted-foreground">
          Sessions and Repository access remain unavailable so existing state is not guessed or overwritten.
        </p>
        <dl className="mt-6 divide-y divide-content-border border-y border-content-border text-sm">
          <div className="py-3">
            <dt className="text-content-muted-foreground">Check</dt>
            <dd className="mt-1 text-content-foreground">{startup.diagnostic}</dd>
          </div>
          <div className="py-3">
            <dt className="text-content-muted-foreground">Preserved</dt>
            <dd className="mt-1 text-content-foreground">
              Database, Pi Sessions, Repositories, branches, and worktrees
            </dd>
          </div>
        </dl>
        {backupMessage && <p className="mt-4 text-sm text-activity-completed">{backupMessage}</p>}
        {error && (
          <p role="alert" className="mt-4 text-sm text-session-message-error-foreground">
            {error}
          </p>
        )}
        <div className="mt-6 flex flex-wrap gap-3">
          <Button plain onClick={() => void createBackup()}>
            <Archive aria-hidden="true" data-slot="icon" />
            Create backup
          </Button>
          <Button color="red" onClick={() => setResetOpen(true)}>
            <RotateCcw aria-hidden="true" data-slot="icon" />
            Reset Railyard…
          </Button>
        </div>
      </section>
      <Dialog open={resetOpen} onClose={setResetOpen}>
        <DialogTitle>Reset Railyard state?</DialogTitle>
        <DialogBody>
          <p>Reset creates a new empty application database. Git and Pi Session files remain untouched.</p>
          <label className="mt-5 block text-sm font-medium text-content-foreground">
            Type RESET to confirm
            <Input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder="RESET" />
          </label>
        </DialogBody>
        <DialogActions>
          <Button plain onClick={() => setResetOpen(false)}>
            Cancel
          </Button>
          <Button color="red" disabled={confirmation !== 'RESET'} onClick={() => void reset()}>
            Reset application state
          </Button>
        </DialogActions>
      </Dialog>
    </main>
  )
}
