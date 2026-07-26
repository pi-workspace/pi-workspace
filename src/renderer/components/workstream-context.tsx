import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  BookOpen,
  FileCheck2,
  FolderGit2,
  FolderOpen,
  GitBranch,
  GitCompareArrows,
  ListOrdered,
  PanelRight,
  PanelRightClose,
} from 'lucide-react'
import { Button } from '@/components/ui-kit/button'
import { Dialog, DialogBody, DialogTitle } from '@/components/ui-kit/dialog'
import type { OwnedSession, Workstream } from '@/src/domain/workstream'
import { projectWorkstreamContext } from '@/src/renderer/workstream-context-projection'
import type { WorkstreamKnowledgeResource } from '@/src/renderer/use-workstream-knowledge'
import { SessionChanges, type SessionChangesSelection } from './session-changes'

type WorkstreamContextProperties = Readonly<{
  workstream: Workstream
  stateResource?: WorkstreamKnowledgeResource
  onShowWorkingLocation?(workstreamId: string, repositoryId: string): Promise<void>
}>

type ContextSectionProperties = Readonly<{
  children: ReactNode
  icon: typeof FileCheck2
  title: string
}>

function ContextSection({ children, icon: Icon, title }: ContextSectionProperties) {
  return (
    <section className="px-5 py-5">
      <div className="flex items-center gap-2">
        <Icon aria-hidden="true" className="size-4 text-content-muted-foreground" />
        <h3 className="text-sm/5 font-medium text-content-foreground">{title}</h3>
      </div>
      <div className="mt-2 text-sm/5 text-content-muted-foreground">{children}</div>
    </section>
  )
}

function RecordList({ children }: Readonly<{ children: ReactNode }>) {
  return <ul className="mt-3 space-y-3">{children}</ul>
}

function workingPathPreview(workingPath: string): string {
  const pathSegments = workingPath.split('/').filter(Boolean)

  return pathSegments.length > 4 ? `…/${pathSegments.slice(-4).join('/')}` : workingPath
}

export function WorkstreamContext({
  workstream,
  stateResource,
  onShowWorkingLocation = async () => {},
}: WorkstreamContextProperties) {
  const [workingLocationError, setWorkingLocationError] = useState<string>()

  if (!workstream.goal) return null

  const projection = projectWorkstreamContext(
    workstream,
    stateResource ?? { status: 'loading', workstreamId: workstream.id }
  )

  return (
    <div aria-label="Workstream knowledge" className="flex min-h-0 min-w-0 flex-1 flex-col bg-content-background">
      <header className="flex h-18 min-w-0 shrink-0 flex-col justify-center border-b border-content-border px-5 py-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs/5 font-medium text-content-muted-foreground">Workstream</p>
          {projection.status && <span className="text-xs/5 text-content-muted-foreground">{projection.status}</span>}
        </div>
        <h2 className="mt-1 min-w-0 truncate text-base/6 font-semibold text-content-foreground" title={workstream.goal}>
          {workstream.goal}
        </h2>
      </header>

      <div className="min-h-0 overflow-y-auto">
        <section className="px-5 py-5">
          <h3 className="text-sm/5 font-medium text-content-foreground">Goal</h3>
          <p className="mt-2 text-sm/6 text-content-muted-foreground">{workstream.goal}</p>
        </section>
        {workstream.repositoryWorkingLocations.length > 0 && (
          <ContextSection icon={FolderGit2} title="Repository checkouts">
            <RecordList>
              {workstream.repositoryWorkingLocations.map((location) => (
                <li className="min-w-0" key={location.repositoryId}>
                  <p className="font-medium text-content-foreground">{location.repositoryName}</p>
                  {location.availability === 'available' ? (
                    <>
                      <code className="mt-1 block break-all text-xs/5" title={location.workingPath}>
                        {workingPathPreview(location.workingPath)}
                      </code>
                      <Button
                        className="mt-2"
                        plain
                        aria-label={`Show ${location.repositoryName} in file manager`}
                        onClick={() => {
                          setWorkingLocationError(undefined)
                          void onShowWorkingLocation(workstream.id, location.repositoryId).catch((error: unknown) => {
                            setWorkingLocationError(
                              error instanceof Error ? error.message : 'Could not open the working location.'
                            )
                          })
                        }}
                      >
                        <FolderOpen aria-hidden="true" data-slot="icon" />
                        Show in file manager
                      </Button>
                    </>
                  ) : (
                    <p>Location unavailable.</p>
                  )}
                </li>
              ))}
            </RecordList>
            {workingLocationError && (
              <p className="mt-3 text-form-error-foreground" role="alert">
                {workingLocationError}
              </p>
            )}
          </ContextSection>
        )}
        {projection.contentMessage ? (
          <ContextSection icon={BookOpen} title="Shared Workstream knowledge">
            <p>{projection.contentMessage}</p>
          </ContextSection>
        ) : !projection.hasKnowledge ? null : (
          <>
            {projection.hasSpecificationContent && (
              <ContextSection icon={FileCheck2} title="Specification">
                <p>{projection.specificationMessage}</p>
              </ContextSection>
            )}
            {projection.specificationVersions.length > 0 && (
              <ContextSection icon={FileCheck2} title="Specification history">
                <RecordList>
                  {projection.specificationVersions.map((version) => (
                    <li key={version.id}>
                      <p className="font-medium text-content-foreground">Version {version.version}</p>
                      <p>
                        Knowledge revision {version.knowledgeRevision} · {version.records.length} source records
                      </p>
                    </li>
                  ))}
                </RecordList>
              </ContextSection>
            )}
            {projection.impacts.length > 0 && (
              <ContextSection icon={GitBranch} title="Repository impacts">
                <RecordList>
                  {projection.impacts.map((impact) => (
                    <li key={impact.id}>
                      <p className="font-medium text-content-foreground">
                        {impact.classification === 'changed' ? 'Changed' : 'Unaffected'} · {impact.repositoryId}
                      </p>
                      <p>{impact.summary}</p>
                    </li>
                  ))}
                </RecordList>
              </ContextSection>
            )}
            {projection.hasKnowledgeRecords && (
              <ContextSection icon={BookOpen} title="Shared knowledge">
                <p>
                  {projection.findings.length} findings, {projection.decisions.length} decisions,{' '}
                  {projection.assumptions.length} assumptions, and {projection.questions.length} questions.
                </p>
                {(projection.decisions.length > 0 || projection.questions.length > 0) && (
                  <RecordList>
                    {projection.decisions.map((decision) => (
                      <li key={decision.id}>
                        <p className="font-medium text-content-foreground">
                          {decision.status === 'accepted'
                            ? 'Accepted decision'
                            : decision.status === 'superseded'
                              ? 'Superseded decision'
                              : 'Proposed decision'}
                        </p>
                        <p>{decision.summary}</p>
                      </li>
                    ))}
                    {projection.questions.map((question) => (
                      <li key={question.id}>
                        <p className="font-medium text-content-foreground">
                          {question.classification === 'blocking' ? 'Blocking' : 'Non-blocking'} ·{' '}
                          {question.status === 'open' ? 'Open' : 'Resolved'}
                        </p>
                        <p>{question.summary}</p>
                      </li>
                    ))}
                  </RecordList>
                )}
              </ContextSection>
            )}
            {(projection.invalidPlanOrder || projection.planSteps.length > 0) && (
              <ContextSection icon={ListOrdered} title="Implementation order">
                {projection.invalidPlanOrder ? (
                  <p>Plan dependencies do not form a valid implementation order.</p>
                ) : (
                  <ol className="mt-3 list-decimal space-y-3 pl-5">
                    {projection.planSteps.map((step) => (
                      <li key={step.id}>
                        <p className="font-medium text-content-foreground">{step.summary}</p>
                        <p>{step.repositoryIds.join(', ')}</p>
                        {step.dependencyIds.length > 0 && <p>After: {step.dependencyIds.join(', ')}</p>}
                      </li>
                    ))}
                  </ol>
                )}
              </ContextSection>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export function WorkstreamSelectionScreen({ workstream }: WorkstreamContextProperties) {
  if (!workstream.goal) return null

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center bg-content-background px-8 py-12">
      <div className="max-w-lg text-center">
        <h1 className="text-xl/7 font-semibold text-content-foreground">{workstream.goal}</h1>
        <p className="mt-3 text-sm/6 text-content-muted-foreground">
          Select a Session to continue, or open this Workstream’s context.
        </p>
      </div>
    </div>
  )
}

type WorkstreamContextLayoutProperties = Readonly<{
  children: ReactNode
  workstream?: Workstream
  activeSession?: OwnedSession
  changesSelection?: SessionChangesSelection
  stateResource?: WorkstreamKnowledgeResource
  onShowWorkingLocation?(workstreamId: string, repositoryId: string): Promise<void>
}>

type UtilityTab = 'knowledge' | 'changes'

export function WorkstreamContextLayout({
  children,
  workstream,
  activeSession,
  changesSelection,
  stateResource,
  onShowWorkingLocation,
}: WorkstreamContextLayoutProperties) {
  const hasKnowledge = Boolean(workstream?.goal)
  const hasChanges = Boolean(activeSession && activeSession.mode !== 'brainstorm')
  const [open, setOpen] = useState(hasKnowledge)
  const [tab, setTab] = useState<UtilityTab>(hasKnowledge ? 'knowledge' : 'changes')
  const [dockWidth, setDockWidth] = useState(420)
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
    setTab('changes')
    setOpen(true)
  }, [changesSelection?.request, hasChanges])

  useEffect(() => {
    if (tab === 'knowledge' && !hasKnowledge && hasChanges) setTab('changes')
    if (tab === 'changes' && !hasChanges && hasKnowledge) setTab('knowledge')
  }, [hasChanges, hasKnowledge, tab])

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

  const utility = (
    <UtilityDock
      activeSession={activeSession}
      changesSelection={changesSelection}
      hasChanges={hasChanges}
      hasKnowledge={hasKnowledge}
      onClose={() => setOpen(false)}
      onSelectTab={setTab}
      onShowWorkingLocation={onShowWorkingLocation}
      stateResource={stateResource}
      tab={tab}
      workstream={workstream}
    />
  )

  return (
    <>
      <div ref={layoutRef} className="flex min-h-0 min-w-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {(hasKnowledge || hasChanges) && (!open || !persistent) && (
            <div className="flex items-center justify-between gap-3 border-b border-content-border px-4 py-2">
              <p className="min-w-0 truncate text-xs/5 text-content-muted-foreground">
                {hasKnowledge ? workstream?.goal : activeSession?.title}
              </p>
              <Button
                plain
                onClick={() => setOpen(true)}
                aria-label={hasKnowledge && !hasChanges ? 'Open Workstream knowledge' : 'Open utility panel'}
              >
                <PanelRight aria-hidden="true" data-slot="icon" />
                {hasChanges ? 'Changes' : 'Knowledge'}
              </Button>
            </div>
          )}
          {children}
        </div>

        {open && persistent && (hasKnowledge || hasChanges) && (
          <>
            <div
              aria-label="Resize utility panel"
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

      {(hasKnowledge || hasChanges) && (
        <Dialog open={open && !persistent} onClose={setOpen} size="xl" scrollable>
          <DialogTitle className="sr-only">
            {hasKnowledge && !hasChanges ? 'Workstream knowledge' : 'Session utility panel'}
          </DialogTitle>
          <DialogBody className="-m-8 flex min-h-[70vh] overflow-hidden">{utility}</DialogBody>
        </Dialog>
      )}
    </>
  )
}

function UtilityDock({
  activeSession,
  changesSelection,
  hasChanges,
  hasKnowledge,
  onClose,
  onSelectTab,
  onShowWorkingLocation,
  stateResource,
  tab,
  workstream,
}: Readonly<{
  activeSession?: OwnedSession
  changesSelection?: SessionChangesSelection
  hasChanges: boolean
  hasKnowledge: boolean
  onClose: () => void
  onSelectTab: (tab: UtilityTab) => void
  onShowWorkingLocation?: (workstreamId: string, repositoryId: string) => Promise<void>
  stateResource?: WorkstreamKnowledgeResource
  tab: UtilityTab
  workstream?: Workstream
}>) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-content-background">
      <div className="flex h-12 shrink-0 items-center gap-1 border-b border-content-border px-2" role="tablist">
        {hasKnowledge && (
          <UtilityTabButton active={tab === 'knowledge'} icon={BookOpen} onClick={() => onSelectTab('knowledge')}>
            Knowledge
          </UtilityTabButton>
        )}
        {hasChanges && (
          <UtilityTabButton active={tab === 'changes'} icon={GitCompareArrows} onClick={() => onSelectTab('changes')}>
            Changes
          </UtilityTabButton>
        )}
        <Button
          className="ml-auto"
          plain
          aria-label={hasKnowledge && !hasChanges ? 'Close Workstream knowledge' : 'Close utility panel'}
          onClick={onClose}
        >
          <PanelRightClose aria-hidden="true" data-slot="icon" />
        </Button>
      </div>
      {tab === 'knowledge' && workstream?.goal ? (
        <WorkstreamContext
          workstream={workstream}
          stateResource={stateResource}
          onShowWorkingLocation={onShowWorkingLocation}
        />
      ) : tab === 'changes' && activeSession ? (
        <SessionChanges sessionId={activeSession.id} selection={changesSelection} />
      ) : null}
    </div>
  )
}

function UtilityTabButton({
  active,
  children,
  icon: Icon,
  onClick,
}: Readonly<{
  active: boolean
  children: ReactNode
  icon: typeof BookOpen
  onClick: () => void
}>) {
  return (
    <button
      aria-selected={active}
      className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs/5 text-content-muted-foreground hover:bg-content-interaction data-[active=true]:bg-content-interaction-strong data-[active=true]:text-content-foreground"
      data-active={active}
      onClick={onClick}
      role="tab"
      type="button"
    >
      <Icon aria-hidden="true" className="size-3.5" />
      {children}
    </button>
  )
}
