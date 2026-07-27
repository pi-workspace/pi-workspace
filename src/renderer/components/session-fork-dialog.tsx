import { GitFork, LoaderCircle, Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui-kit/button'
import { Dialog, DialogActions, DialogBody, DialogDescription, DialogTitle } from '@/components/ui-kit/dialog'
import { Field, Label } from '@/components/ui-kit/fieldset'
import { Input, InputGroup } from '@/components/ui-kit/input'
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

type ForkPointCardProperties = Readonly<{
  point: SessionForkPoint
  selected: boolean
  onSelect(): void
}>

function ForkPointCard({ point, selected, onSelect }: ForkPointCardProperties) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className="group relative w-full overflow-hidden rounded-xl border border-content-border bg-content-background px-4 py-3 text-left outline-none transition-colors motion-reduce:transition-none hover:border-content-hover-border hover:bg-content-subtle-background focus-visible:ring-2 focus-visible:ring-focus-ring data-[selected=true]:border-accent data-[selected=true]:bg-content-subtle-background"
      data-selected={selected ? 'true' : undefined}
      onClick={onSelect}
    >
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-0 w-0.5 bg-accent opacity-0 transition-opacity motion-reduce:transition-none group-data-[selected=true]:opacity-100"
      />
      <span className="flex items-center justify-between gap-3 text-xs/4 text-content-muted-foreground">
        <span>
          Message {point.position} of {point.total}
        </span>
        {selected && <span className="font-medium text-content-foreground">Starts here</span>}
      </span>
      <span className="mt-1.5 line-clamp-3 whitespace-pre-wrap break-words text-sm/5 text-content-foreground">
        {point.text}
      </span>
    </button>
  )
}

function SelectedForkPoint({ point }: Readonly<{ point: SessionForkPoint }>) {
  return (
    <div className="relative ml-2 border-l-2 border-accent py-1 pl-5">
      <span className="absolute top-0 -left-3 flex size-6 items-center justify-center rounded-full bg-accent text-accent-foreground ring-4 ring-content-background">
        <GitFork aria-hidden="true" className="size-3.5" />
      </span>
      <p className="text-xs/4 font-medium text-content-muted-foreground">
        Message {point.position} of {point.total}
      </p>
      <p className="mt-2 line-clamp-4 whitespace-pre-wrap break-words text-sm/5 text-content-foreground">
        {point.text}
      </p>
      <p className="mt-2 text-xs/5 text-content-muted-foreground">
        This message becomes an editable draft in the new Session.
      </p>
    </div>
  )
}

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
          setPoints([])
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

  const selectedPoint = points?.find((point) => point.entryId === selectedEntryId)
  const selectedPointVisible = visiblePoints.some((point) => point.entryId === selectedEntryId)
  const choosingForkPoint = initialPosition === undefined

  const repositoryState =
    session.mode === 'implement'
      ? 'This fork stays in Implement mode and creates new worktrees when it prepares each Repository. Worktree paths in copied history are reference only.'
      : session.mode === 'brainstorm'
        ? 'This fork stays in Brainstorm mode and in the current Workstream.'
        : workingLocation === 'worktrees'
          ? 'This fork starts from the current HEAD in a separate worktree. Uncommitted changes are not copied.'
          : 'This fork uses the same Repository checkout. Your files stay as they are—they do not rewind with the Session history.'

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
    <Dialog
      className="flex max-h-full flex-col overflow-hidden p-0!"
      open={open}
      onClose={close}
      size={choosingForkPoint ? '4xl' : 'xl'}
      scrollable
    >
      <div className="shrink-0 border-b border-content-border px-6 py-4 sm:px-7">
        <DialogTitle className="flex items-center gap-2.5">
          <span className="flex size-7 items-center justify-center rounded-lg bg-content-subtle-background">
            <GitFork aria-hidden="true" className="size-4 text-content-foreground" />
          </span>
          {choosingForkPoint ? 'Fork Session' : 'Fork from this message'}
        </DialogTitle>
        <DialogDescription className="max-w-2xl">
          {choosingForkPoint
            ? 'Choose where the new Session begins. Everything before that message is copied into its history.'
            : 'Create a new Session from this point without changing the current Session.'}
        </DialogDescription>
      </div>

      <DialogBody className="mt-0! min-h-0 overflow-y-auto px-6 py-5 sm:px-7">
        {choosingForkPoint ? (
          <div className="grid min-h-0 gap-7 sm:grid-cols-[minmax(0,1.2fr)_minmax(16rem,0.8fr)]">
            <section aria-labelledby="session-fork-point-heading" className="min-w-0">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <h2 id="session-fork-point-heading" className="text-sm/5 font-semibold text-content-foreground">
                    Start from
                  </h2>
                  <p className="mt-1 text-xs/5 text-content-muted-foreground">
                    The selected message returns as your draft.
                  </p>
                </div>
                {points && points.length > 0 && (
                  <span className="shrink-0 text-xs/5 text-content-muted-foreground">
                    {points.length} {points.length === 1 ? 'message' : 'messages'}
                  </span>
                )}
              </div>

              {points && points.length > 4 && (
                <div className="mt-4">
                  <InputGroup>
                    <Search aria-hidden="true" data-slot="icon" />
                    <Input
                      aria-label="Search user messages"
                      placeholder="Search user messages"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                    />
                  </InputGroup>
                </div>
              )}

              <div className="mt-4 max-h-[min(25rem,48vh)] space-y-2.5 overflow-y-auto pr-1">
                {!points ? (
                  <p
                    className="flex items-center gap-2 rounded-xl border border-content-border px-4 py-6 text-sm/5 text-content-muted-foreground"
                    role="status"
                  >
                    <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />
                    Loading messages…
                  </p>
                ) : visiblePoints.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-content-border px-4 py-6 text-sm/5 text-content-muted-foreground">
                    {points.length === 0
                      ? error
                        ? 'Session messages could not be loaded.'
                        : 'No user messages are available to fork.'
                      : 'No messages match this search.'}
                  </p>
                ) : (
                  visiblePoints.map((point) => (
                    <ForkPointCard
                      key={point.entryId}
                      point={point}
                      selected={point.entryId === selectedEntryId}
                      onSelect={() => setSelectedEntryId(point.entryId)}
                    />
                  ))
                )}
              </div>
            </section>

            <div className="min-w-0 space-y-5 rounded-xl border border-content-border bg-content-subtle-background p-4">
              <Field>
                <Label>New Session name</Label>
                <Input value={title} onChange={(event) => setTitle(event.target.value)} />
              </Field>
              <div className="border-t border-content-border pt-4">
                <p className="text-xs/5 font-semibold tracking-wide text-content-foreground uppercase">
                  Repository handling
                </p>
                <p className="mt-2 text-sm/5 text-content-muted-foreground">{repositoryState}</p>
              </div>
              {error && (
                <p className="border-t border-content-border pt-4 text-sm/5 text-form-error-foreground" role="alert">
                  {error}
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            <section aria-labelledby="selected-fork-point-heading">
              <h2 id="selected-fork-point-heading" className="mb-4 text-sm/5 font-semibold text-content-foreground">
                New starting point
              </h2>
              {!points ? (
                <p
                  className="flex items-center gap-2 rounded-xl border border-content-border px-4 py-6 text-sm/5 text-content-muted-foreground"
                  role="status"
                >
                  <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />
                  Loading message…
                </p>
              ) : selectedPoint ? (
                <SelectedForkPoint point={selectedPoint} />
              ) : (
                <p className="rounded-xl border border-dashed border-content-border px-4 py-6 text-sm/5 text-content-muted-foreground">
                  {error ? 'This message could not be loaded.' : 'This message is no longer available to fork.'}
                </p>
              )}
            </section>

            <Field>
              <Label>New Session name</Label>
              <Input value={title} onChange={(event) => setTitle(event.target.value)} />
            </Field>

            <div className="rounded-xl border border-content-border bg-content-subtle-background p-4">
              <p className="text-xs/5 font-semibold tracking-wide text-content-foreground uppercase">
                Repository handling
              </p>
              <p className="mt-2 text-sm/5 text-content-muted-foreground">{repositoryState}</p>
            </div>

            {error && (
              <p className="text-sm/5 text-form-error-foreground" role="alert">
                {error}
              </p>
            )}
          </div>
        )}
      </DialogBody>

      <DialogActions className="mt-0! shrink-0 border-t border-content-border bg-content-subtle-background px-6 py-4 sm:px-7">
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
