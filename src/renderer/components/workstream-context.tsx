import { useEffect, useRef, useState, type ReactNode } from 'react'
import { GitCompareArrows, PanelRight, PanelRightClose } from 'lucide-react'
import { Button } from '@/components/ui-kit/button'
import { Dialog, DialogBody, DialogTitle } from '@/components/ui-kit/dialog'
import type { OwnedSession, Workstream } from '@/src/domain/workstream'
import { SessionChanges, type SessionChangesSelection } from './session-changes'

type WorkstreamSelectionScreenProperties = Readonly<{
  workstream: Workstream
}>

export function WorkstreamSelectionScreen({ workstream }: WorkstreamSelectionScreenProperties) {
  if (!workstream.goal) return null

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center bg-content-background px-8 py-12">
      <div className="max-w-lg text-center">
        <h1 className="text-xl/7 font-semibold text-content-foreground">{workstream.goal}</h1>
        <p className="mt-3 text-sm/6 text-content-muted-foreground">Select a Session to continue.</p>
      </div>
    </div>
  )
}

type WorkstreamContextLayoutProperties = Readonly<{
  children: ReactNode
  activeSession?: OwnedSession
  changesSelection?: SessionChangesSelection
}>

export function WorkstreamContextLayout({
  children,
  activeSession,
  changesSelection,
}: WorkstreamContextLayoutProperties) {
  const hasChanges = Boolean(activeSession)
  const [open, setOpen] = useState(hasChanges)
  const [dockWidth, setDockWidth] = useState(520)
  const [layoutWidth, setLayoutWidth] = useState(0)
  const layoutRef = useRef<HTMLDivElement>(null)
  const persistent = layoutWidth >= 400 + dockWidth

  useEffect(() => {
    const element = layoutRef.current
    if (!element) return

    const updateWidth = () => setLayoutWidth(element.getBoundingClientRect().width)
    updateWidth()

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateWidth)
      return () => window.removeEventListener('resize', updateWidth)
    }

    const observer = new ResizeObserver(updateWidth)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!changesSelection || !hasChanges) return
    setOpen(true)
  }, [changesSelection?.request, hasChanges])

  const resizeDock = (nextWidth: number) => {
    const maximum = Math.min(720, Math.max(320, layoutWidth - 400))
    setDockWidth(Math.max(320, Math.min(maximum, nextWidth)))
  }

  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = dockWidth

    const move = (moveEvent: PointerEvent) => resizeDock(startWidth + startX - moveEvent.clientX)
    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }

  const utility = activeSession && (
    <ChangesUtilityDock activeSession={activeSession} onClose={() => setOpen(false)} selection={changesSelection} />
  )

  return (
    <>
      <div ref={layoutRef} className="flex min-h-0 min-w-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {hasChanges && (!open || !persistent) && (
            <div className="flex items-center justify-between gap-3 border-b border-content-border px-4 py-2">
              <p className="min-w-0 truncate text-xs/5 text-content-muted-foreground">{activeSession?.title}</p>
              <Button plain onClick={() => setOpen(true)} aria-label="Open Changes">
                <PanelRight aria-hidden="true" data-slot="icon" />
                Changes
              </Button>
            </div>
          )}
          {children}
        </div>

        {open && persistent && hasChanges && utility && (
          <>
            <div
              aria-label="Resize Changes panel"
              aria-orientation="vertical"
              aria-valuemax={720}
              aria-valuemin={320}
              aria-valuenow={dockWidth}
              className="w-1 shrink-0 cursor-col-resize bg-content-border hover:bg-content-hover-border focus-visible:outline-2 focus-visible:outline-focus-ring"
              onKeyDown={(event) => {
                if (event.key === 'ArrowLeft') resizeDock(dockWidth + 20)
                if (event.key === 'ArrowRight') resizeDock(dockWidth - 20)
              }}
              onPointerDown={startResize}
              role="separator"
              tabIndex={0}
            />
            <aside className="flex shrink-0 border-l border-content-border" style={{ width: dockWidth }}>
              {utility}
            </aside>
          </>
        )}
      </div>

      {hasChanges && utility && (
        <Dialog open={open && !persistent} onClose={setOpen} size="xl" scrollable>
          <DialogTitle className="sr-only">Changes</DialogTitle>
          <DialogBody className="-m-8 flex min-h-[70vh] overflow-hidden">{utility}</DialogBody>
        </Dialog>
      )}
    </>
  )
}

function ChangesUtilityDock({
  activeSession,
  onClose,
  selection,
}: Readonly<{
  activeSession: OwnedSession
  onClose: () => void
  selection?: SessionChangesSelection
}>) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-content-background">
      <div className="flex h-12 shrink-0 items-center gap-1 border-b border-content-border px-2">
        <span className="flex items-center gap-1.5 rounded-md bg-content-interaction-strong px-2.5 py-1.5 text-xs/5 text-content-foreground">
          <GitCompareArrows aria-hidden="true" className="size-3.5" />
          Changes
        </span>
        <Button className="ml-auto" plain aria-label="Close Changes" onClick={onClose}>
          <PanelRightClose aria-hidden="true" data-slot="icon" />
        </Button>
      </div>
      <SessionChanges sessionId={activeSession.id} selection={selection} />
    </div>
  )
}
