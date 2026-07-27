import { Button } from '@/components/ui-kit/button'
import { ChevronDown, ChevronRight, CircleCheck, CircleSlash2, CircleX, ExternalLink, LoaderCircle } from 'lucide-react'
import { useState } from 'react'
import type { AgentActivity, AgentActivityDetails, ActivityArtifact } from '@/src/session-timeline'
import { DiffView } from './diff-view'

type AgentActivityCardProperties = Readonly<{
  activity: AgentActivity
  loadDetails: () => Promise<AgentActivityDetails | undefined>
  onOpenCurrentDiff?: (repositoryId: string | undefined, path: string) => void
}>

const statusPresentation = {
  running: { label: 'Running', Icon: LoaderCircle, className: 'text-activity-running' },
  pending: { label: 'Pending', Icon: LoaderCircle, className: 'text-activity-running' },
  completed: { label: 'Completed', Icon: CircleCheck, className: 'text-activity-completed' },
  failed: { label: 'Failed', Icon: CircleX, className: 'text-activity-failed' },
  blocked: { label: 'Blocked', Icon: CircleSlash2, className: 'text-activity-blocked' },
} as const

export function AgentActivityCard({
  activity,
  loadDetails,
  onOpenCurrentDiff = () => {},
}: AgentActivityCardProperties) {
  const [details, setDetails] = useState<AgentActivityDetails>()
  const [detailState, setDetailState] = useState<'idle' | 'loading' | 'failed'>('idle')
  const [operationsExpanded, setOperationsExpanded] = useState(false)
  const [expandedPreviewKey, setExpandedPreviewKey] = useState<string>()
  const presentation = statusPresentation[activity.status]
  const sections = artifactSections(activity.artifacts)

  const ensureDetails = async () => {
    if (detailState !== 'idle' || details) return

    setDetailState('loading')

    try {
      const loaded = await loadDetails()
      if (loaded) setDetails(loaded)
      setDetailState(loaded ? 'idle' : 'failed')
    } catch {
      setDetailState('failed')
    }
  }

  const toggleOperations = async () => {
    if (operationsExpanded) {
      setOperationsExpanded(false)

      return
    }

    setOperationsExpanded(true)

    await ensureDetails()
  }

  return (
    <details
      className="activity-card rounded-xl border border-activity-border bg-activity-background px-4 py-3"
      open={activity.status === 'failed' || activity.status === 'blocked' ? true : undefined}
    >
      <summary className="cursor-pointer list-none outline-none focus-visible:ring-2 focus-visible:ring-focus-ring">
        <div className="flex min-w-0 items-start gap-3">
          <presentation.Icon
            aria-hidden="true"
            className={`mt-0.5 size-4 shrink-0 ${presentation.className} ${activity.status === 'running' ? 'animate-spin motion-reduce:animate-none' : ''}`}
          />
          <div className="min-w-0 flex-1">
            <h2 className="text-sm/5 font-medium text-content-foreground">{activity.title}</h2>
            <span className="sr-only">{presentation.label}</span>
            {(activity.summary || activity.secondaryLine || activity.expectedOutcome) && (
              <p className="mt-1 text-sm/5 text-content-muted-foreground">
                {activity.summary ?? activity.secondaryLine ?? activity.expectedOutcome}
              </p>
            )}
            <p className="mt-1.5 flex flex-wrap gap-x-3 text-xs/5 text-content-muted-foreground">
              <span>{activity.operationCount} operations</span>
              <span>{activity.fileCount} files</span>
            </p>
          </div>
        </div>
      </summary>

      <div className="mt-3 space-y-3 border-t border-activity-border pt-3">
        {sections.map((section) => (
          <section key={section.title}>
            <h3 className="text-xs/5 font-semibold text-content-foreground">{section.title}</h3>
            <ul className="mt-1 space-y-1 text-xs/5 text-content-muted-foreground">
              {section.items.map((item) => {
                const preview = details?.operations.find(
                  (operation) =>
                    operation.preview !== undefined &&
                    operation.preview.path === item.path &&
                    operation.preview.repositoryId === item.repositoryId
                )?.preview
                const expanded = expandedPreviewKey === item.key

                return (
                  <li key={item.key}>
                    {item.path ? (
                      <>
                        <button
                          aria-expanded={expanded}
                          className="flex w-full min-w-0 items-center gap-1.5 rounded px-1 py-0.5 text-left hover:bg-content-interaction focus-visible:outline-2 focus-visible:outline-focus-ring"
                          onClick={() => {
                            setExpandedPreviewKey(expanded ? undefined : item.key)
                            if (!expanded) void ensureDetails()
                          }}
                          type="button"
                        >
                          <ChevronRight
                            aria-hidden="true"
                            className={`size-3.5 shrink-0 ${expanded ? 'rotate-90' : ''}`}
                          />
                          <span className="min-w-0 flex-1 truncate" title={item.label}>
                            {item.label}
                          </span>
                        </button>
                        {expanded && (
                          <div className="mt-2 space-y-2 pl-5">
                            {detailState === 'loading' ? (
                              <p>Loading operation-time preview…</p>
                            ) : preview ? (
                              <>
                                <p>Operation-time {preview.kind === 'diff' ? 'diff' : 'snapshot'}</p>
                                <DiffView
                                  content={preview.content}
                                  kind={preview.kind}
                                  label={`Operation-time preview for ${preview.path}`}
                                />
                                {preview.truncated && <p>The operation-time preview was truncated.</p>}
                                <Button plain onClick={() => onOpenCurrentDiff(preview.repositoryId, preview.path)}>
                                  <ExternalLink aria-hidden="true" data-slot="icon" />
                                  Open current diff
                                </Button>
                              </>
                            ) : (
                              <p>Operation-time preview unavailable.</p>
                            )}
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        {item.status === 'completed' && (
                          <CircleCheck aria-hidden="true" className="size-3.5 shrink-0 text-activity-completed" />
                        )}
                        {item.status === 'failed' && (
                          <CircleX aria-hidden="true" className="size-3.5 shrink-0 text-activity-failed" />
                        )}
                        <span>{item.label}</span>
                        {item.status && <span className="sr-only">{item.status}</span>}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          </section>
        ))}

        {activity.operationCount > 0 && (
          <div className="sticky top-0 z-10 bg-activity-background py-1">
            <Button
              plain
              className="w-full justify-between! px-2! py-1.5! text-xs/5! items-center"
              aria-expanded={operationsExpanded}
              aria-controls={`${activity.id}-operations`}
              onClick={() => void toggleOperations()}
            >
              <span>Operations {activity.operationCount}</span>
              <ChevronDown
                data-slot="icon"
                aria-hidden="true"
                className={operationsExpanded ? 'rotate-180' : undefined}
              />
            </Button>
          </div>
        )}
        {operationsExpanded && (
          <div id={`${activity.id}-operations`}>
            {detailState === 'loading' && (
              <p className="text-xs/5 text-content-muted-foreground">Loading operations…</p>
            )}
            {detailState === 'failed' && <p className="text-xs/5 text-activity-failed">Details are unavailable.</p>}
            {details && (
              <ol className="divide-y divide-activity-border rounded-lg border border-activity-border">
                {details.operations.map((operation) => (
                  <li
                    key={operation.toolCallId}
                    className="flex min-w-0 items-center justify-between gap-3 px-3 py-2 text-xs/5 text-content-foreground"
                  >
                    <div className="flex min-w-0 flex-1 items-baseline gap-2">
                      <span className="max-w-[40%] shrink-0 truncate capitalize" title={operation.label}>
                        {operation.label}
                      </span>
                      {operation.inputPreview && (
                        <>
                          <span aria-hidden="true" className="shrink-0 text-content-muted-foreground">
                            ·
                          </span>
                          <span
                            className="min-w-0 truncate text-content-muted-foreground"
                            title={operation.inputPreview}
                          >
                            {operation.inputPreview}
                          </span>
                        </>
                      )}
                    </div>
                    {operation.status === 'running' && (
                      <LoaderCircle
                        aria-hidden="true"
                        className="size-3.5 shrink-0 animate-spin text-activity-running motion-reduce:animate-none"
                      />
                    )}
                    {operation.status === 'failed' && (
                      <CircleX aria-hidden="true" className="size-3.5 shrink-0 text-activity-failed" />
                    )}
                    <span className="sr-only">{operation.status}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
      </div>
    </details>
  )
}

function artifactSections(artifacts: readonly ActivityArtifact[]): readonly {
  title: string
  items: readonly {
    key: string
    label: string
    path?: string
    repositoryId?: string
    status?: 'completed' | 'failed'
  }[]
}[] {
  const changed = artifacts.flatMap((artifact) => {
    if (artifact.type !== 'file-change') return []

    const counts =
      artifact.additions === undefined || artifact.deletions === undefined
        ? ''
        : ` (+${artifact.additions} −${artifact.deletions})`

    return [
      {
        key: `changed-${artifact.repositoryId ?? 'session'}-${artifact.path}`,
        label: `${artifact.path}${counts}`,
        path: artifact.path,
        repositoryId: artifact.repositoryId,
      },
    ]
  })

  const validation = artifacts.flatMap((artifact) =>
    artifact.type === 'validation'
      ? [{ key: `check-${artifact.label}`, label: artifact.label, status: artifact.status }]
      : []
  )

  return [
    { title: 'Changed', items: changed },
    { title: 'Checks', items: validation },
  ].filter((section) => section.items.length > 0)
}
