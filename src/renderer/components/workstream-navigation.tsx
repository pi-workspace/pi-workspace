import { useEffect, useId, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, GitBranch, Hammer, Plus, Telescope } from 'lucide-react'
import { Button } from '@/components/ui-kit/button'
import { Dialog, DialogActions, DialogBody, DialogDescription, DialogTitle } from '@/components/ui-kit/dialog'
import { Description, Field, FieldGroup, Fieldset, Label } from '@/components/ui-kit/fieldset'
import { Input } from '@/components/ui-kit/input'
import { Radio, RadioField, RadioGroup } from '@/components/ui-kit/radio'
import { SidebarHeading, SidebarSection } from '@/components/ui-kit/sidebar'
import { Textarea } from '@/components/ui-kit/textarea'
import type { WorkspaceRepositorySnapshot } from '@/src/application-state'
import type { SessionId } from '@/src/domain/session'
import type {
  CreateQuickSessionOptions,
  CreateSessionOptions,
  CreateWorkstreamOptions,
  ManagedSessionMode,
  Workstream,
  WorkstreamLifecycle,
  WorkstreamWorkingLocation,
  WorktreeLocationsPreview,
} from '@/src/domain/workstream'
import { QuickSessionsGroup, WorkstreamGroup, type SessionTitleEditing } from './workstream-navigation-groups'

export type WorkstreamNavigationProperties = Readonly<{
  workstreams: readonly Workstream[]
  repositories: readonly WorkspaceRepositorySnapshot[]
  activeSessionId?: SessionId
  selectedWorkstreamId?: string
  pinnedSessionIds: readonly SessionId[]
  workingSessionIds: ReadonlySet<SessionId>
  titleEditing?: SessionTitleEditing
  createRequest?: number
  quickSessionCreateRequest?: number
  loading?: boolean
  loadError?: string
  onStartTitleEditing?: (sessionId: SessionId) => void
  onTitleChange?: (title: string) => void
  onSaveTitle?: () => void
  onCancelTitleEditing?: () => void
  onActivateSession(sessionId: SessionId): void
  onCreateWorkstream(options: CreateWorkstreamOptions): Promise<void>
  onCreateQuickSession(options: CreateQuickSessionOptions): Promise<void>
  onCreateSession(workstreamId: string, options: CreateSessionOptions): Promise<void>
  onPreviewWorktreeLocations(repositoryId: string): Promise<WorktreeLocationsPreview>
  onSetWorkstreamLifecycle(workstreamId: string, lifecycle: WorkstreamLifecycle): Promise<void>
  onSelectWorkstream(workstreamId: string): void
  onToggleSessionPin(sessionId: SessionId): void
}>

type DialogState =
  | Readonly<{ type: 'create-workstream' }>
  | Readonly<{ type: 'create-quick-session' }>
  | Readonly<{ type: 'create-session'; workstream: Workstream }>

type SessionModeSelectorProperties = Readonly<{
  mode: ManagedSessionMode
  onChange(mode: ManagedSessionMode): void
}>

function SessionModeSelector({ mode, onChange }: SessionModeSelectorProperties) {
  return (
    <RadioGroup
      aria-label="Session mode"
      className="space-y-2!"
      value={mode}
      onChange={(value) => {
        if (value === 'brainstorm' || value === 'implement') onChange(value)
      }}
    >
      <RadioField className="rounded-lg border border-content-border bg-content-background p-2.5">
        <Radio value="implement" />
        <Label className="flex items-center gap-2">
          <Hammer aria-hidden="true" className="size-4 text-content-muted-foreground" />
          Implement
        </Label>
        <Description>Change and validate Workspace Repositories with Pi&apos;s normal tools.</Description>
      </RadioField>
      <RadioField className="rounded-lg border border-content-border bg-content-background p-2.5">
        <Radio value="brainstorm" />
        <Label className="flex items-center gap-2">
          <Telescope aria-hidden="true" className="size-4 text-content-muted-foreground" />
          Brainstorm
        </Label>
        <Description>Investigate Workspace Repositories without modifying their content.</Description>
      </RadioField>
    </RadioGroup>
  )
}

export function WorkstreamNavigation({
  workstreams,
  repositories,
  activeSessionId,
  selectedWorkstreamId,
  pinnedSessionIds,
  workingSessionIds,
  titleEditing,
  createRequest,
  quickSessionCreateRequest,
  loading = false,
  loadError,
  onStartTitleEditing = () => {},
  onTitleChange = () => {},
  onSaveTitle = () => {},
  onCancelTitleEditing = () => {},
  onActivateSession,
  onCreateWorkstream,
  onCreateQuickSession,
  onCreateSession,
  onPreviewWorktreeLocations,
  onSetWorkstreamLifecycle,
  onSelectWorkstream,
  onToggleSessionPin,
}: WorkstreamNavigationProperties) {
  const [dialog, setDialog] = useState<DialogState>()
  const [quickSessionsOpen, setQuickSessionsOpen] = useState(true)
  const [workstreamsOpen, setWorkstreamsOpen] = useState(true)
  const quickSessionsId = useId()
  const workstreamsId = useId()
  const [goal, setGoal] = useState('')
  const [title, setTitle] = useState('')
  const [mode, setMode] = useState<ManagedSessionMode>('implement')
  const [workingLocation, setWorkingLocation] = useState<WorkstreamWorkingLocation>('current-checkouts')
  const [worktreePreview, setWorktreePreview] = useState<WorktreeLocationsPreview>()
  const [previewingWorktrees, setPreviewingWorktrees] = useState(false)
  const [quickSessionRepositoryId, setQuickSessionRepositoryId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  const worktreePreviewRequest = useRef(0)
  const availableRepositories = repositories.filter((repository) => repository.availability === 'available')
  const visibleWorkstreams = workstreams.filter(
    (workstream) => workstream.lifecycle === 'active' || workstream.unavailability !== undefined
  )
  const quickWorkstreams = visibleWorkstreams.filter((workstream) => !workstream.goal)
  const goalWorkstreams = visibleWorkstreams.filter((workstream) => workstream.goal)
  const activeWorkstreamId = workstreams.find((workstream) =>
    workstream.sessions.some((session) => session.id === activeSessionId)
  )?.id
  const closeDialog = () => {
    if (saving) return

    worktreePreviewRequest.current += 1
    setDialog(undefined)
    setError(undefined)
  }

  const openWorkstreamDialog = () => {
    worktreePreviewRequest.current += 1
    setGoal('')
    setMode('implement')
    setWorkingLocation('current-checkouts')
    setWorktreePreview(undefined)
    setPreviewingWorktrees(false)
    setError(undefined)
    setDialog({ type: 'create-workstream' })
  }

  useEffect(() => {
    if (createRequest !== undefined) openWorkstreamDialog()
  }, [createRequest])

  const previewWorkingLocations = (repositoryId: string) => {
    const request = worktreePreviewRequest.current + 1
    worktreePreviewRequest.current = request
    setWorktreePreview(undefined)
    setPreviewingWorktrees(true)
    void onPreviewWorktreeLocations(repositoryId)
      .then((preview) => {
        if (worktreePreviewRequest.current === request) setWorktreePreview(preview)
      })
      .catch((operationError: unknown) => {
        if (worktreePreviewRequest.current === request) {
          setError(
            operationError instanceof Error ? operationError.message : 'Could not preview the worktree locations.'
          )
        }
      })
      .finally(() => {
        if (worktreePreviewRequest.current === request) setPreviewingWorktrees(false)
      })
  }

  const selectWorkingLocation = (location: WorkstreamWorkingLocation, repositoryId: string) => {
    setWorkingLocation(location)
    setError(undefined)

    if (location === 'current-checkouts') {
      worktreePreviewRequest.current += 1
      setPreviewingWorktrees(false)
      return
    }
    if (worktreePreview) return

    previewWorkingLocations(repositoryId)
  }

  const openQuickSession = () => {
    if (availableRepositories.length === 0) {
      setError('Add an available Repository before starting a Quick Session.')
      return
    }

    worktreePreviewRequest.current += 1
    setQuickSessionRepositoryId(availableRepositories[0]!.id)
    setWorkingLocation('current-checkouts')
    setWorktreePreview(undefined)
    setPreviewingWorktrees(false)
    setError(undefined)
    setDialog({ type: 'create-quick-session' })
  }

  useEffect(() => {
    if (quickSessionCreateRequest !== undefined) openQuickSession()
  }, [quickSessionCreateRequest])

  const openSessionDialog = (workstream: Workstream) => {
    setTitle('')
    setMode('implement')
    setError(undefined)
    setDialog({ type: 'create-session', workstream })
  }

  const run = async (operation: () => Promise<void>) => {
    setSaving(true)
    setError(undefined)

    try {
      await operation()
      setDialog(undefined)
    } catch (operationError) {
      setError(operationError instanceof Error ? operationError.message : 'Could not create the Session.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <SidebarSection>
        <div className="flex items-center gap-1">
          <SidebarHeading className="mb-0 min-w-0 flex-1 px-0">
            <button
              type="button"
              aria-controls={quickSessionsId}
              aria-expanded={quickSessionsOpen}
              className="flex w-full items-center gap-1 rounded-sm py-1 text-left hover:bg-sidebar-interaction hover:text-sidebar-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
              onClick={() => setQuickSessionsOpen((open) => !open)}
            >
              {quickSessionsOpen ? (
                <ChevronDown aria-hidden="true" className="size-4 shrink-0" />
              ) : (
                <ChevronRight aria-hidden="true" className="size-4 shrink-0" />
              )}
              <span className="min-w-0 truncate">Quick Sessions</span>
            </button>
          </SidebarHeading>
          <button
            type="button"
            aria-label="Start a Quick Session"
            disabled={loading || Boolean(loadError) || saving}
            className="shrink-0 rounded-sm p-1.5 text-sidebar-muted-foreground hover:bg-sidebar-interaction hover:text-sidebar-foreground disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            onClick={openQuickSession}
          >
            <Plus aria-hidden="true" className="size-4" />
          </button>
        </div>
        {quickSessionsOpen && (
          <div id={quickSessionsId}>
            {error && !dialog && (
              <p className="px-2 py-1 text-xs/5 text-form-error-foreground" role="alert">
                {error}
              </p>
            )}
            {!loading && !loadError && quickWorkstreams.length > 0 && (
              <div className="mt-1">
                <QuickSessionsGroup
                  workstreams={quickWorkstreams}
                  activeSessionId={activeSessionId}
                  pinnedSessionIds={pinnedSessionIds}
                  workingSessionIds={workingSessionIds}
                  titleEditing={titleEditing}
                  onStartTitleEditing={onStartTitleEditing}
                  onTitleChange={onTitleChange}
                  onSaveTitle={onSaveTitle}
                  onCancelTitleEditing={onCancelTitleEditing}
                  onActivateSession={onActivateSession}
                  onSetLifecycle={onSetWorkstreamLifecycle}
                  onToggleSessionPin={onToggleSessionPin}
                />
              </div>
            )}
          </div>
        )}
      </SidebarSection>

      <SidebarSection>
        <div className="flex items-center gap-1">
          <SidebarHeading className="mb-0 min-w-0 flex-1 px-0">
            <button
              type="button"
              aria-controls={workstreamsId}
              aria-expanded={workstreamsOpen}
              className="flex w-full items-center gap-1 rounded-sm py-1 text-left hover:bg-sidebar-interaction hover:text-sidebar-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
              onClick={() => setWorkstreamsOpen((open) => !open)}
            >
              {workstreamsOpen ? (
                <ChevronDown aria-hidden="true" className="size-4 shrink-0" />
              ) : (
                <ChevronRight aria-hidden="true" className="size-4 shrink-0" />
              )}
              <span className="min-w-0 truncate">Workstreams</span>
            </button>
          </SidebarHeading>
          <button
            type="button"
            aria-label="Create a Workstream"
            disabled={loading || Boolean(loadError)}
            className="shrink-0 rounded-sm p-1.5 text-sidebar-muted-foreground hover:bg-sidebar-interaction hover:text-sidebar-foreground disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            onClick={openWorkstreamDialog}
          >
            <Plus aria-hidden="true" className="size-4" />
          </button>
        </div>
        {workstreamsOpen && (
          <div id={workstreamsId}>
            {loading ? (
              <p className="px-2 py-5 text-sm/5 text-sidebar-muted-foreground" role="status">
                Loading Workstreams…
              </p>
            ) : loadError ? (
              <div className="px-2 py-5 text-sm/5 text-form-error-foreground" role="alert">
                <p className="font-medium">Could not load Workstreams.</p>
                <p className="mt-1">{loadError}</p>
              </div>
            ) : goalWorkstreams.length > 0 ? (
              <div className="mt-1 flex flex-col gap-1">
                {goalWorkstreams.map((workstream, index) => (
                  <WorkstreamGroup
                    key={workstream.id}
                    workstream={workstream}
                    activeSessionId={activeSessionId}
                    selected={workstream.id === selectedWorkstreamId}
                    pinnedSessionIds={pinnedSessionIds}
                    workingSessionIds={workingSessionIds}
                    titleEditing={titleEditing}
                    initiallyOpen={workstream.id === activeWorkstreamId || (!activeWorkstreamId && index === 0)}
                    onStartTitleEditing={onStartTitleEditing}
                    onTitleChange={onTitleChange}
                    onSaveTitle={onSaveTitle}
                    onCancelTitleEditing={onCancelTitleEditing}
                    onActivateSession={onActivateSession}
                    onNewSession={openSessionDialog}
                    onSetLifecycle={onSetWorkstreamLifecycle}
                    onSelectWorkstream={onSelectWorkstream}
                    onToggleSessionPin={onToggleSessionPin}
                  />
                ))}
              </div>
            ) : (
              <p className="px-2 py-5 text-sm/5 text-sidebar-muted-foreground">No Workstreams yet.</p>
            )}
          </div>
        )}
      </SidebarSection>

      <Dialog open={dialog?.type === 'create-quick-session'} onClose={closeDialog} size="md">
        <DialogTitle>Start a Quick Session</DialogTitle>
        <DialogDescription>
          Choose the Repository and working location that Standard Pi can change directly.
        </DialogDescription>
        <DialogBody className="mt-5! min-w-0">
          <Fieldset className="min-w-0">
            <Field className="min-w-0">
              <Label>Repository</Label>
              <RadioGroup
                aria-label="Repository"
                className="mt-3 space-y-2!"
                value={quickSessionRepositoryId}
                onChange={(value) => {
                  if (typeof value !== 'string') return

                  setQuickSessionRepositoryId(value)
                  setError(undefined)
                  if (workingLocation === 'worktrees') {
                    previewWorkingLocations(value)
                  } else {
                    worktreePreviewRequest.current += 1
                    setWorktreePreview(undefined)
                    setPreviewingWorktrees(false)
                  }
                }}
              >
                {repositories.map((repository) => (
                  <RadioField
                    key={repository.id}
                    className="rounded-lg border border-content-border p-2.5"
                    title={repository.directoryPath}
                    onClick={(event) => {
                      if (repository.availability === 'unavailable') return
                      if (event.target instanceof Element && event.target.closest('[role="radio"]')) return

                      event.preventDefault()
                      event.stopPropagation()
                      setQuickSessionRepositoryId(repository.id)
                      setError(undefined)
                      if (workingLocation === 'worktrees') {
                        previewWorkingLocations(repository.id)
                      } else {
                        worktreePreviewRequest.current += 1
                        setWorktreePreview(undefined)
                        setPreviewingWorktrees(false)
                      }
                    }}
                  >
                    <Radio disabled={repository.availability === 'unavailable'} value={repository.id} />
                    <Label>{repository.name}</Label>
                    {repository.availability === 'unavailable' && <Description>Unavailable</Description>}
                  </RadioField>
                ))}
              </RadioGroup>
            </Field>
            <Field className="mt-5">
              <Label>Working location</Label>
              <RadioGroup
                aria-label="Working location"
                className="mt-3 space-y-2!"
                value={workingLocation}
                onChange={(value) => {
                  if (value === 'current-checkouts' || value === 'worktrees') {
                    selectWorkingLocation(value, quickSessionRepositoryId)
                  }
                }}
              >
                <RadioField
                  className="rounded-lg border border-content-border p-3"
                  onClick={(event) => {
                    if (event.target instanceof Element && event.target.closest('[role="radio"]')) return

                    event.preventDefault()
                    event.stopPropagation()
                    selectWorkingLocation('current-checkouts', quickSessionRepositoryId)
                  }}
                >
                  <Radio value="current-checkouts" />
                  <Label>Current checkout</Label>
                  <Description>Use the selected Repository’s existing checkout.</Description>
                </RadioField>
                <RadioField
                  className="rounded-lg border border-content-border p-3"
                  onClick={(event) => {
                    if (event.target instanceof Element && event.target.closest('[role="radio"]')) return

                    event.preventDefault()
                    event.stopPropagation()
                    selectWorkingLocation('worktrees', quickSessionRepositoryId)
                  }}
                >
                  <Radio value="worktrees" />
                  <Label className="flex items-center gap-2">
                    <GitBranch aria-hidden="true" className="size-4 text-content-muted-foreground" />
                    New worktree
                  </Label>
                  <Description>Create a separate ordinary Git worktree for this Quick Session.</Description>
                </RadioField>
              </RadioGroup>
            </Field>
          </Fieldset>
          {error && (
            <p className="mt-4 text-sm text-form-error-foreground" role="alert">
              {error}
            </p>
          )}
        </DialogBody>
        <DialogActions className="mt-6!">
          <Button plain onClick={closeDialog}>
            Cancel
          </Button>
          <Button
            color="accent"
            disabled={
              saving ||
              !quickSessionRepositoryId ||
              previewingWorktrees ||
              (workingLocation === 'worktrees' && !worktreePreview)
            }
            onClick={() =>
              void run(() =>
                onCreateQuickSession({
                  repositoryId: quickSessionRepositoryId,
                  workingLocation,
                  ...(worktreePreview ? { workstreamId: worktreePreview.workstreamId } : {}),
                })
              )
            }
          >
            {saving ? 'Starting…' : 'Start Quick Session'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={dialog?.type === 'create-workstream'} onClose={closeDialog} size="lg">
        <DialogTitle>Create a Workstream</DialogTitle>
        <DialogDescription>
          Set the durable goal that will connect this Workstream’s Sessions and Repository context.
        </DialogDescription>
        <DialogBody className="mt-5! min-w-0">
          <Fieldset className="min-w-0">
            <FieldGroup className="min-w-0 space-y-5!">
              <Field>
                <Label>Goal</Label>
                <Description>Describe the outcome you want to reach, not the first task to perform.</Description>
                <Textarea
                  autoFocus
                  rows={2}
                  placeholder="Ship cancellation reasons across the app and API"
                  value={goal}
                  onChange={(event) => setGoal(event.target.value)}
                />
              </Field>
              <Field>
                <Label>First Session mode</Label>
                <Description>The mode is permanent for this Session.</Description>
                <SessionModeSelector mode={mode} onChange={setMode} />
              </Field>
            </FieldGroup>
          </Fieldset>
          {error && (
            <p className="mt-4 text-sm text-form-error-foreground" role="alert">
              {error}
            </p>
          )}
        </DialogBody>
        <DialogActions className="mt-6!">
          <Button plain onClick={closeDialog}>
            Cancel
          </Button>
          <Button
            color="accent"
            disabled={saving || !goal.trim()}
            onClick={() => void run(() => onCreateWorkstream({ goal, mode }))}
          >
            {saving ? 'Creating…' : 'Create Workstream'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={dialog?.type === 'create-session'} onClose={closeDialog} size="lg">
        <DialogTitle>Start a new Session</DialogTitle>
        <DialogDescription>
          This Session stays with “{dialog?.type === 'create-session' ? dialog.workstream.goal : ''}” and keeps the mode
          you choose.
        </DialogDescription>
        <DialogBody className="mt-5!">
          <Fieldset>
            <FieldGroup className="space-y-5!">
              <Field>
                <Label>Session name</Label>
                <Input
                  autoFocus
                  placeholder="New Session"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </Field>
              <Field>
                <Label>Session mode</Label>
                <Description>
                  The mode belongs only to this Session. Workspace Repository access is automatic.
                </Description>
                <SessionModeSelector mode={mode} onChange={setMode} />
              </Field>
            </FieldGroup>
          </Fieldset>
          {error && (
            <p className="mt-4 text-sm text-form-error-foreground" role="alert">
              {error}
            </p>
          )}
        </DialogBody>
        <DialogActions className="mt-6!">
          <Button plain onClick={closeDialog}>
            Cancel
          </Button>
          <Button
            color="accent"
            disabled={saving}
            onClick={() => {
              if (dialog?.type !== 'create-session') return
              void run(() => onCreateSession(dialog.workstream.id, { mode, title }))
            }}
          >
            {saving ? 'Creating…' : 'Create Session'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
