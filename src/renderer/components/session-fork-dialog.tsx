import { GitFork, LoaderCircle, Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui-kit/button'
import { Dialog, DialogActions, DialogBody, DialogDescription, DialogTitle } from '@/components/ui-kit/dialog'
import { Field, Label } from '@/components/ui-kit/fieldset'
import { Input } from '@/components/ui-kit/input'
import type {
  ForkSessionOptions,
  OwnedSession,
  SessionForkPoint,
  WorkstreamWorkingLocation,
} from '@/src/domain/workstream'

type SessionForkDialogProperties = Readonly<{
  open: boolean
  session: OwnedSession
  initialPosition?: number
  workingLocation: WorkstreamWorkingLocation
  getForkPoints(): Promise<readonly SessionForkPoint[]>
  onFork(options: ForkSessionOptions): Promise<void>
  onClose(): void
}>

export function SessionForkDialog({
  open,
  session,
  initialPosition,
  workingLocation,
  getForkPoints,
  onFork,
  onClose,
}: SessionForkDialogProperties) {
  const [points, setPoints] = useState<readonly SessionForkPoint[]>()
  const [selectedEntryId, setSelectedEntryId] = useState<string>()
  const [title, setTitle] = useState('')
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string>()
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return

    let active = true
    setPoints(undefined)
    setSelectedEntryId(undefined)
    setTitle(`Fork of ${session.title}`)
    setQuery('')
    setError(undefined)
    setSaving(false)

    void getForkPoints()
      .then((forkPoints) => {
        if (!active) return

        setPoints(forkPoints)
        const selected = initialPosition
          ? forkPoints.find((point) => point.position === initialPosition)
          : forkPoints.at(-1)
        setSelectedEntryId(selected?.entryId)
      })
      .catch((operationError: unknown) => {
        if (active) {
          setError(operationError instanceof Error ? operationError.message : 'Could not load Session messages.')
        }
      })

    return () => {
      active = false
    }
  }, [getForkPoints, initialPosition, open, session.title])

  const visiblePoints = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase()
    if (!normalizedQuery) return points ?? []

    return (points ?? []).filter((point) => point.text.toLocaleLowerCase().includes(normalizedQuery))
  }, [points, query])

  const selectedPointVisible = visiblePoints.some((point) => point.entryId === selectedEntryId)

  const repositoryState =
    session.mode === 'implement'
      ? 'The fork creates its own worktrees when it prepares Repositories. Earlier worktree paths are reference only.'
      : session.mode === 'brainstorm'
        ? 'The fork remains a Brainstorm Session in this Workstream.'
        : workingLocation === 'worktrees'
          ? 'The fork gets a separate worktree from this working location’s current HEAD. Uncommitted changes are not copied.'
          : 'The fork uses the same Repository checkout. Files are not returned to this earlier point.'

  const close = () => {
    if (!saving) onClose()
  }

  const fork = async () => {
    if (!selectedEntryId || !selectedPointVisible || !title.trim() || saving) return

    setSaving(true)
    setError(undefined)

    try {
      await onFork({ entryId: selectedEntryId, title })
      onClose()
    } catch (operationError) {
      setError(operationError instanceof Error ? operationError.message : 'Could not fork the Session.')
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onClose={close} size="xl" scrollable>
      <DialogTitle className="flex items-center gap-2">
        <GitFork aria-hidden="true" className="size-4 text-content-muted-foreground" />
        Fork Session
      </DialogTitle>
      <DialogDescription>
        Choose a user message. History before it is copied, and that message becomes an editable draft.
      </DialogDescription>
      <DialogBody className="min-w-0">
        <div className="grid min-h-0 gap-5 sm:grid-cols-[minmax(0,1fr)_minmax(14rem,0.72fr)]">
          <Field className="min-w-0">
            <Label>User message</Label>
            <div className="relative mt-2">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-content-muted-foreground"
              />
              <Input
                id="session-fork-search"
                className="pl-9"
                placeholder="Search messages"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <div className="mt-3 max-h-72 space-y-2 overflow-y-auto pr-1">
              {!points ? (
                <p className="flex items-center gap-2 px-3 py-5 text-sm/5 text-content-muted-foreground" role="status">
                  <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />
                  Loading messages…
                </p>
              ) : visiblePoints.length === 0 ? (
                <p className="px-3 py-5 text-sm/5 text-content-muted-foreground">
                  {points.length === 0 ? 'No user messages are available to fork.' : 'No messages match this search.'}
                </p>
              ) : (
                visiblePoints.map((point) => {
                  const selected = point.entryId === selectedEntryId

                  return (
                    <button
                      key={point.entryId}
                      type="button"
                      aria-pressed={selected}
                      className="w-full rounded-lg border border-content-border bg-content-background px-3 py-2.5 text-left text-sm/5 text-content-foreground outline-none transition-colors hover:bg-content-subtle-background focus-visible:ring-2 focus-visible:ring-focus-ring data-[selected=true]:border-focus-ring data-[selected=true]:bg-content-subtle-background"
                      data-selected={selected ? 'true' : undefined}
                      onClick={() => setSelectedEntryId(point.entryId)}
                    >
                      <span className="line-clamp-2 whitespace-pre-wrap break-words">{point.text}</span>
                      <span className="mt-1 block text-xs/4 text-content-muted-foreground">
                        Message {point.position} of {point.total}
                      </span>
                    </button>
                  )
                })
              )}
            </div>
          </Field>

          <div className="min-w-0 space-y-5">
            <Field>
              <Label>New Session name</Label>
              <Input value={title} onChange={(event) => setTitle(event.target.value)} />
            </Field>
            <div className="rounded-lg border border-content-border bg-content-subtle-background p-3 text-sm/5">
              <p className="font-medium text-content-foreground">Repository state</p>
              <p className="mt-1 text-content-muted-foreground">{repositoryState}</p>
            </div>
            {error && (
              <p className="text-sm/5 text-form-error-foreground" role="alert">
                {error}
              </p>
            )}
          </div>
        </div>
      </DialogBody>
      <DialogActions>
        <Button plain disabled={saving} onClick={close}>
          Cancel
        </Button>
        <Button
          color="accent"
          disabled={saving || !selectedEntryId || !selectedPointVisible || !title.trim()}
          onClick={() => void fork()}
        >
          {saving ? 'Forking…' : 'Fork Session'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
