import { Copy, GitBranch, LoaderCircle, RefreshCw, Search } from 'lucide-react'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui-kit/button'
import { Dialog, DialogActions, DialogBody, DialogDescription, DialogTitle } from '@/components/ui-kit/dialog'
import { Input, InputGroup } from '@/components/ui-kit/input'
import type { SessionId } from '@/src/domain/session'
import type {
  SessionRepositoryBranch,
  SessionRepositoryBranchesSnapshot,
  SessionRepositoryWorkingLocation,
  SessionWorkingLocationsBridge,
  SessionWorkingLocationsSnapshot,
} from '@/src/session-working-locations'

const lazilyRefreshedRepositories = new WeakMap<SessionWorkingLocationsBridge, Set<string>>()

type SessionBranchPickerProperties = Readonly<{
  bridge: SessionWorkingLocationsBridge
  isWorking: boolean
  location: Extract<SessionRepositoryWorkingLocation, { availability: 'available' }>
  sessionId: SessionId
  onMutationChange: (mutating: boolean) => void
  onWorkingLocationsChange: (snapshot: SessionWorkingLocationsSnapshot) => void
}>

export function SessionBranchPicker({
  bridge,
  isWorking,
  location,
  sessionId,
  onMutationChange,
  onWorkingLocationsChange,
}: SessionBranchPickerProperties) {
  const request = useRef(0)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [snapshot, setSnapshot] = useState<SessionRepositoryBranchesSnapshot>()
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [switching, setSwitching] = useState(false)
  const [error, setError] = useState<string>()
  const [confirmation, setConfirmation] = useState<SessionRepositoryBranch>()

  const loadBranches = async (refresh: boolean) => {
    const currentRequest = ++request.current
    if (refresh) setRefreshing(true)
    else setLoading(true)
    setError(undefined)

    try {
      const nextSnapshot = await bridge.getBranches(sessionId, location.repositoryId, { refresh })
      if (request.current !== currentRequest) return

      setSnapshot(nextSnapshot)
      if (nextSnapshot.refreshError) setError(nextSnapshot.refreshError)
    } catch (operationError) {
      if (request.current === currentRequest) {
        setError(operationError instanceof Error ? operationError.message : 'Branches could not be loaded.')
      }
    } finally {
      if (request.current === currentRequest) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }

  const openPicker = () => {
    if (isWorking || switching) return

    setOpen(true)
    setQuery('')
    setConfirmation(undefined)
    setError(undefined)

    void loadBranches(false).then(() => {
      const refreshedRepositories = lazilyRefreshedRepositories.get(bridge) ?? new Set<string>()
      lazilyRefreshedRepositories.set(bridge, refreshedRepositories)
      if (refreshedRepositories.has(location.repositoryId)) return

      refreshedRepositories.add(location.repositoryId)
      void loadBranches(true)
    })
  }

  const closePicker = () => {
    if (switching) return

    request.current += 1
    setOpen(false)
    setConfirmation(undefined)
    setLoading(false)
    setRefreshing(false)
  }

  const switchBranch = async (branch: SessionRepositoryBranch) => {
    setSwitching(true)
    setError(undefined)
    onMutationChange(true)

    try {
      const nextSnapshot = await bridge.switchBranch(sessionId, location.repositoryId, branch.ref)
      onWorkingLocationsChange(nextSnapshot)
      setOpen(false)
      setConfirmation(undefined)
    } catch (operationError) {
      setError(operationError instanceof Error ? operationError.message : 'The branch could not be switched.')
    } finally {
      setSwitching(false)
      onMutationChange(false)
    }
  }

  const selectBranch = (branch: SessionRepositoryBranch) => {
    if (branch.current || switching) return

    if (location.kind === 'current-checkout') {
      setConfirmation(branch)
      return
    }

    void switchBranch(branch)
  }

  const branches = snapshot?.branches.filter((branch) => branch.name.toLowerCase().includes(query.toLowerCase())) ?? []
  const localBranches = branches.filter((branch) => branch.kind === 'local')
  const remoteBranches = branches.filter((branch) => branch.kind === 'remote')
  const label = location.kind === 'worktree' ? `Worktree · ${location.branch}` : `Current checkout · ${location.branch}`

  return (
    <>
      <button
        type="button"
        aria-label={label}
        disabled={isWorking || switching}
        className="flex min-w-0 max-w-[55%] items-center gap-1.5 rounded-md px-2 py-1 text-composer-muted-foreground hover:bg-composer-interaction hover:text-content-foreground disabled:opacity-50"
        title={location.workingPath}
        onClick={(event) => {
          event.stopPropagation()
          openPicker()
        }}
      >
        {switching ? (
          <LoaderCircle aria-hidden="true" className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none" />
        ) : (
          <GitBranch aria-hidden="true" className="size-3.5 shrink-0" />
        )}
        <span className="truncate">{switching ? 'Switching branch…' : label}</span>
      </button>

      <Dialog open={open} onClose={closePicker} size="md">
        {confirmation ? (
          <>
            <DialogTitle>Switch shared checkout?</DialogTitle>
            <DialogDescription>
              Switching to {confirmation.name} changes this Repository for every Session using its current checkout. The
              working tree must be clean and every affected Session must be idle.
            </DialogDescription>
            {error && (
              <p className="mt-4 text-sm/5 text-form-error-foreground" role="alert">
                {error}
              </p>
            )}
            <DialogActions>
              <Button plain disabled={switching} onClick={() => setConfirmation(undefined)}>
                Back
              </Button>
              <Button color="accent" disabled={switching} onClick={() => void switchBranch(confirmation)}>
                {switching ? 'Switching…' : `Switch to ${confirmation.name}`}
              </Button>
            </DialogActions>
          </>
        ) : (
          <>
            <DialogTitle>Switch branch</DialogTitle>
            <DialogDescription>
              Choose a local branch or a remote branch to create its local tracking branch.
            </DialogDescription>
            <DialogBody>
              {location.kind === 'worktree' && (
                <button
                  type="button"
                  aria-label="Copy worktree path"
                  className="mb-3 flex max-w-full items-center gap-2 rounded-md px-2 py-1 text-xs/5 text-content-muted-foreground hover:bg-content-interaction hover:text-content-foreground focus-visible:outline-2 focus-visible:outline-focus-ring"
                  title={location.workingPath}
                  onClick={() => void window.navigator.clipboard.writeText(location.workingPath).catch(() => {})}
                >
                  <Copy aria-hidden="true" className="size-3.5 shrink-0" />
                  <span className="truncate">Copy worktree path</span>
                </button>
              )}
              <InputGroup>
                <Search aria-hidden="true" data-slot="icon" />
                <Input
                  aria-label="Search branches"
                  autoFocus
                  type="search"
                  value={query}
                  placeholder="Search branches"
                  onChange={(event) => setQuery(event.target.value)}
                />
              </InputGroup>

              <div className="mt-4 max-h-72 overflow-y-auto rounded-lg border border-content-border">
                {loading && !snapshot ? (
                  <p className="flex items-center gap-2 px-3 py-4 text-sm/5 text-content-muted-foreground">
                    <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />
                    Loading branches…
                  </p>
                ) : branches.length === 0 ? (
                  <p className="px-3 py-4 text-sm/5 text-content-muted-foreground">No matching branches.</p>
                ) : (
                  <>
                    <BranchGroup label="Local branches" branches={localBranches} onSelect={selectBranch} />
                    <BranchGroup label="Remote branches" branches={remoteBranches} onSelect={selectBranch} />
                  </>
                )}
              </div>

              <div className="mt-3 flex min-h-8 items-center justify-between gap-3 text-xs/5 text-content-muted-foreground">
                <span aria-live="polite">
                  {refreshing ? 'Refreshing remote branches…' : error ? error : 'Remote branches load when needed.'}
                </span>
                <Button
                  plain
                  aria-label="Refresh branches"
                  className="shrink-0"
                  disabled={refreshing || loading}
                  onClick={() => void loadBranches(true)}
                >
                  <RefreshCw
                    aria-hidden="true"
                    className={refreshing ? 'animate-spin motion-reduce:animate-none' : ''}
                  />
                  Refresh
                </Button>
              </div>
            </DialogBody>
            <DialogActions>
              <Button plain onClick={closePicker}>
                Cancel
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </>
  )
}

function BranchGroup({
  label,
  branches,
  onSelect,
}: Readonly<{
  label: string
  branches: readonly SessionRepositoryBranch[]
  onSelect: (branch: SessionRepositoryBranch) => void
}>) {
  if (branches.length === 0) return null

  return (
    <section className="border-b border-content-border last:border-b-0">
      <h3 className="px-3 pt-2.5 pb-1 text-xs/5 font-medium text-content-muted-foreground">{label}</h3>
      <ul className="pb-1.5">
        {branches.map((branch) => (
          <li key={branch.ref}>
            <button
              type="button"
              aria-current={branch.current ? 'true' : undefined}
              disabled={branch.current}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm/5 text-content-foreground hover:bg-content-interaction focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-focus-ring disabled:cursor-default"
              onClick={() => onSelect(branch)}
            >
              <GitBranch aria-hidden="true" className="size-4 shrink-0 text-content-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{branch.name}</span>
              {branch.current && <span className="text-xs text-content-muted-foreground">Current</span>}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
