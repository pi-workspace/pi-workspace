import { useState, type ReactNode } from 'react'
import { BookOpen, FileCheck2, FolderGit2, FolderOpen, GitBranch, ListOrdered, PanelRight } from 'lucide-react'
import { Button } from '@/components/ui-kit/button'
import { Dialog, DialogActions, DialogBody, DialogTitle } from '@/components/ui-kit/dialog'
import type { Workstream } from '@/src/domain/workstream'
import { projectWorkstreamContext } from '@/src/renderer/workstream-context-projection'
import type { WorkstreamKnowledgeResource } from '@/src/renderer/use-workstream-knowledge'

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
          <ContextSection icon={FolderGit2} title="Working location">
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
  stateResource?: WorkstreamKnowledgeResource
  onShowWorkingLocation?(workstreamId: string, repositoryId: string): Promise<void>
}>

export function WorkstreamContextLayout({
  children,
  workstream,
  stateResource,
  onShowWorkingLocation,
}: WorkstreamContextLayoutProperties) {
  const [contextOpen, setContextOpen] = useState(false)
  const hasKnowledge = Boolean(workstream?.goal)

  return (
    <>
      <div className="flex min-h-0 min-w-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {hasKnowledge && (
            <div className="flex items-center justify-between gap-3 border-b border-content-border px-4 py-2 min-[1180px]:hidden">
              <p className="min-w-0 truncate text-xs/5 text-content-muted-foreground">{workstream?.goal}</p>
              <Button plain onClick={() => setContextOpen(true)} aria-label="Open Workstream knowledge">
                <PanelRight aria-hidden="true" data-slot="icon" />
                Context
              </Button>
            </div>
          )}
          {children}
        </div>

        {workstream?.goal && (
          <aside className="hidden w-80 shrink-0 border-l border-content-border min-[1180px]:flex">
            <WorkstreamContext
              workstream={workstream}
              stateResource={stateResource}
              onShowWorkingLocation={onShowWorkingLocation}
            />
          </aside>
        )}
      </div>

      {workstream?.goal && (
        <Dialog open={contextOpen} onClose={setContextOpen} size="md">
          <DialogTitle>Workstream knowledge</DialogTitle>
          <DialogBody className="-mx-8 -mb-8 max-h-[70vh] overflow-y-auto">
            <WorkstreamContext
              workstream={workstream}
              stateResource={stateResource}
              onShowWorkingLocation={onShowWorkingLocation}
            />
          </DialogBody>
          <DialogActions>
            <Button plain aria-label="Close Workstream knowledge" onClick={() => setContextOpen(false)}>
              Close
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </>
  )
}
