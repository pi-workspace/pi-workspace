import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, CircleAlert, FileCode2, GitBranch, LoaderCircle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui-kit/button'
import type { SessionId } from '@/src/domain/session'
import type {
  SessionChangeFile,
  SessionChangesSnapshot,
  SessionFileDiff,
  SessionFileDiffView,
} from '@/src/session-changes'
import { DiffView } from './diff-view'

export type SessionChangesSelection = Readonly<{
  repositoryId?: string
  path: string
  request: number
}>

type SessionChangesProperties = Readonly<{
  sessionId: SessionId
  selection?: SessionChangesSelection
}>

type SelectedFile = Readonly<{ repositoryId: string; repositoryName: string; file: SessionChangeFile }>

export function SessionChanges({ sessionId, selection }: SessionChangesProperties) {
  const [snapshot, setSnapshot] = useState<SessionChangesSnapshot>()
  const [error, setError] = useState<string>()
  const [selected, setSelected] = useState<SelectedFile>()
  const [view, setView] = useState<SessionFileDiffView>('all')
  const [diff, setDiff] = useState<SessionFileDiff>()
  const [diffLoading, setDiffLoading] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const requestRef = useRef(0)
  const diffRequestRef = useRef(0)
  const selectedRef = useRef<SelectedFile | undefined>(undefined)
  const fileButtonRefs = useRef(new Map<string, HTMLButtonElement>())

  const refresh = useCallback(async () => {
    const request = ++requestRef.current
    setError(undefined)

    try {
      const next = await window.piWorkspace.sessionChanges.getSnapshot(sessionId)
      if (request !== requestRef.current) return

      setSnapshot(next)
      const current = selectedRef.current
      if (current) {
        const repository = next.repositories.find((candidate) => candidate.repositoryId === current.repositoryId)
        const file = repository?.files.find((candidate) => candidate.path === current.file.path)

        if (repository && file) {
          setSelected({ repositoryId: repository.repositoryId, repositoryName: repository.repositoryName, file })
        } else {
          setSelected(undefined)
          setAnnouncement(`${current.file.path} is no longer changed.`)
        }
      }
    } catch (loadError) {
      if (request !== requestRef.current) return
      setError(loadError instanceof Error ? loadError.message : 'Changes are unavailable.')
    }
  }, [sessionId])

  useEffect(() => {
    setSnapshot(undefined)
    setSelected(undefined)
    setDiff(undefined)
    void refresh()

    const unsubscribe = window.piWorkspace.transcript.subscribe((mutation) => {
      if (mutation.sessionId === sessionId) void refresh()
    })
    const handleFocus = () => void refresh()
    window.addEventListener('focus', handleFocus)

    return () => {
      requestRef.current += 1
      diffRequestRef.current += 1
      unsubscribe()
      window.removeEventListener('focus', handleFocus)
    }
  }, [refresh, sessionId])

  useEffect(() => {
    selectedRef.current = selected
  }, [selected])

  useEffect(() => {
    if (!selection || !snapshot) return

    for (const repository of snapshot.repositories) {
      if (selection.repositoryId && selection.repositoryId !== repository.repositoryId) continue
      const file = repository.files.find((candidate) => candidate.path === selection.path)
      if (file) {
        setSelected({ repositoryId: repository.repositoryId, repositoryName: repository.repositoryName, file })
        setView('all')
        return
      }
    }
  }, [selection?.request, snapshot])

  useEffect(() => {
    if (!selected) return

    const request = ++diffRequestRef.current
    setDiff(undefined)
    setDiffLoading(true)

    void window.piWorkspace.sessionChanges
      .loadFileDiff(sessionId, selected.repositoryId, selected.file.path, view)
      .then((next) => {
        if (request === diffRequestRef.current) setDiff(next)
      })
      .catch((loadError: unknown) => {
        if (request !== diffRequestRef.current) return
        setDiff({
          status: 'unavailable',
          message: loadError instanceof Error ? loadError.message : 'The diff is unavailable.',
        })
      })
      .finally(() => {
        if (request === diffRequestRef.current) setDiffLoading(false)
      })
  }, [selected?.repositoryId, selected?.file.path, sessionId, view])

  if (selected) {
    const views: SessionFileDiffView[] = [
      'all',
      ...(selected.file.staged ? (['staged'] as const) : []),
      ...(selected.file.unstaged ? (['unstaged'] as const) : []),
    ]

    return (
      <div className="flex min-h-0 flex-1 flex-col bg-content-background">
        <header className="sticky top-0 z-20 border-b border-content-border bg-content-background px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <Button
              plain
              aria-label="Back to changed files"
              onClick={() => {
                const key = `${selected.repositoryId}:${selected.file.path}`
                setSelected(undefined)
                window.requestAnimationFrame(() => fileButtonRefs.current.get(key)?.focus())
              }}
            >
              <ArrowLeft aria-hidden="true" data-slot="icon" />
            </Button>
            <div className="min-w-0">
              <h3 className="truncate text-sm/5 font-medium text-content-foreground" title={selected.file.path}>
                {selected.file.path}
              </h3>
              <p className="truncate text-xs/4 text-content-muted-foreground">{selected.repositoryName}</p>
            </div>
          </div>
          {views.length > 1 && (
            <div aria-label="Diff view" className="mt-3 flex gap-1" role="tablist">
              {views.map((candidate) => (
                <button
                  aria-selected={view === candidate}
                  className="rounded-md px-2.5 py-1 text-xs/5 capitalize text-content-muted-foreground hover:bg-content-interaction data-[selected=true]:bg-content-interaction-strong data-[selected=true]:text-content-foreground"
                  data-selected={view === candidate}
                  key={candidate}
                  onClick={() => setView(candidate)}
                  role="tab"
                  type="button"
                >
                  {candidate}
                </button>
              ))}
            </div>
          )}
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {diffLoading ? (
            <ResourceMessage icon={LoaderCircle} message="Loading diff…" spinning />
          ) : diff?.content ? (
            <>
              {diff.message && <p className="mb-2 text-xs/5 text-content-muted-foreground">{diff.message}</p>}
              <DiffView content={diff.content} label={`Diff for ${selected.file.path}`} />
            </>
          ) : (
            <ResourceMessage icon={CircleAlert} message={diff?.message ?? 'The diff is unavailable.'} />
          )}
        </div>
      </div>
    )
  }

  const fileCount = snapshot?.repositories.reduce((count, repository) => count + repository.files.length, 0) ?? 0

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-content-background">
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-content-border px-4">
        <div>
          <h2 className="text-sm/5 font-semibold text-content-foreground">Session changes</h2>
          <p className="text-xs/4 text-content-muted-foreground">{fileCount} changed files</p>
        </div>
        <Button plain aria-label="Refresh Session changes" onClick={() => void refresh()}>
          <RefreshCw aria-hidden="true" data-slot="icon" />
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!snapshot && !error ? (
          <ResourceMessage icon={LoaderCircle} message="Loading changes…" spinning />
        ) : error ? (
          <div className="p-5 text-center">
            <ResourceMessage icon={CircleAlert} message={error} />
            <Button className="mt-3" outline onClick={() => void refresh()}>
              Retry
            </Button>
          </div>
        ) : snapshot?.repositories.length === 0 ? (
          <ResourceMessage icon={GitBranch} message="No writable Repository has been prepared for this Session." />
        ) : fileCount === 0 ? (
          <ResourceMessage icon={GitBranch} message="This Session has no uncommitted changes." />
        ) : (
          snapshot?.repositories.map((repository) => (
            <section className="border-b border-content-border last:border-b-0" key={repository.repositoryId}>
              <div className="bg-content-subtle-background px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <GitBranch aria-hidden="true" className="size-3.5 text-content-muted-foreground" />
                  <h3 className="truncate text-xs/5 font-semibold text-content-foreground">
                    {repository.repositoryName}
                  </h3>
                </div>
                <p className="mt-0.5 truncate text-xs/4 text-content-muted-foreground">
                  {repository.branch.head}
                  {repository.branch.ahead > 0 ? ` · ${repository.branch.ahead} ahead` : ''}
                  {repository.branch.behind > 0 ? ` · ${repository.branch.behind} behind` : ''}
                </p>
                {repository.error && <p className="mt-1 text-xs/4 text-form-error-foreground">{repository.error}</p>}
              </div>
              <ul>
                {repository.files.map((file) => (
                  <li key={file.path}>
                    <button
                      ref={(button) => {
                        const key = `${repository.repositoryId}:${file.path}`
                        if (button) fileButtonRefs.current.set(key, button)
                        else fileButtonRefs.current.delete(key)
                      }}
                      className="flex w-full min-w-0 items-center gap-3 px-4 py-2.5 text-left hover:bg-content-interaction focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-focus-ring"
                      onClick={() =>
                        setSelected({
                          repositoryId: repository.repositoryId,
                          repositoryName: repository.repositoryName,
                          file,
                        })
                      }
                      type="button"
                    >
                      <FileCode2 aria-hidden="true" className="size-4 shrink-0 text-content-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate text-xs/5 text-content-foreground" title={file.path}>
                        {file.path}
                      </span>
                      <span className="flex shrink-0 gap-1 text-[10px]/4 font-medium uppercase text-content-muted-foreground">
                        {file.staged && <span title="Staged">S</span>}
                        {file.unstaged && <span title="Unstaged">U</span>}
                        <span>{file.status.slice(0, 1)}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
      <p aria-live="polite" className="sr-only">
        {announcement || `${fileCount} changed files.`}
      </p>
    </div>
  )
}

function ResourceMessage({
  icon: Icon,
  message,
  spinning = false,
}: Readonly<{ icon: typeof CircleAlert; message: string; spinning?: boolean }>) {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center gap-2 p-5 text-center text-xs/5 text-content-muted-foreground">
      <Icon aria-hidden="true" className={`size-5 ${spinning ? 'animate-spin motion-reduce:animate-none' : ''}`} />
      <p>{message}</p>
    </div>
  )
}
