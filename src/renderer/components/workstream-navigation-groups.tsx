import clsx from 'clsx'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import {
  Archive,
  ArchiveRestore,
  Bookmark,
  ChevronDown,
  ChevronRight,
  Ellipsis,
  GitBranch,
  Hammer,
  LoaderCircle,
  Plus,
  SquareTerminal,
  Telescope,
  Workflow,
} from 'lucide-react'
import { Dropdown, DropdownButton, DropdownItem, DropdownLabel, DropdownMenu } from '@/components/ui-kit/dropdown'
import { SidebarItem, SidebarLabel, SidebarSection } from '@/components/ui-kit/sidebar'
import type { SessionId } from '@/src/domain/session'
import type { Workstream, WorkstreamLifecycle } from '@/src/domain/workstream'
import { getSessionUnavailability, sessionUnavailabilityContext } from '@/src/renderer/session-availability'
import { SessionTitleEditor } from './session-title-editor'

export type SessionTitleEditing = Readonly<{
  sessionId: SessionId
  title: string
  error?: string
  saving: boolean
  origin: 'header' | 'sidebar'
}>

function workstreamLabel(workstream: Workstream): string {
  return workstream.goal || (workstream.unavailability ? 'Quick Session' : 'Sessions')
}

function sessionModeLabel(session: Workstream['sessions'][number]): string {
  if (session.mode === 'default') return 'Default'
  return session.mode === 'brainstorm' ? 'Brainstorm' : 'Implement'
}

function sessionContext(session: Workstream['sessions'][number]): string {
  const mode = sessionModeLabel(session)

  const unavailableContext = sessionUnavailabilityContext(session)

  if (session.mode === 'default') {
    return `${session.repositoryAccess.repositoryName}${unavailableContext ? ` · ${unavailableContext}` : ''}`
  }
  return unavailableContext ? `${mode} · ${unavailableContext}` : mode
}

const sessionListClassName =
  'relative ml-4 pl-2 before:absolute before:inset-y-0 before:left-0 before:w-px before:bg-linear-to-b before:from-transparent before:via-sidebar-border before:to-transparent'

function SessionWorkingIcon({ icon, working }: Readonly<{ icon: ReactNode; working: boolean }>) {
  const reduceMotion = useReducedMotion()
  const transition = reduceMotion ? { duration: 0 } : { duration: 0.16, ease: 'easeOut' as const }

  return (
    <>
      <span aria-hidden="true" className="relative mt-0.5 grid size-4 shrink-0 place-items-center overflow-hidden">
        <AnimatePresence initial={false}>
          <motion.span
            key={working ? 'working' : 'mode'}
            className="absolute inset-0"
            initial={reduceMotion ? false : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
            transition={transition}
          >
            {working ? (
              <LoaderCircle
                data-slot="session-working-icon"
                className="block size-4 animate-spin text-sidebar-muted-foreground motion-reduce:animate-none"
              />
            ) : (
              icon
            )}
          </motion.span>
        </AnimatePresence>
      </span>
      {working && <span className="sr-only">Pi is working</span>}
    </>
  )
}

function WorkingSessionsIndicator({ count, visible }: Readonly<{ count: number; visible: boolean }>) {
  const label = `${count} working ${count === 1 ? 'Session' : 'Sessions'}`

  return (
    <span
      aria-hidden={visible ? undefined : 'true'}
      aria-label={visible ? label : undefined}
      className={clsx(
        'grid size-4 shrink-0 place-items-center transition-opacity duration-150 motion-reduce:transition-none',
        visible ? 'opacity-100' : 'opacity-0'
      )}
    >
      <LoaderCircle
        aria-hidden="true"
        className={clsx('size-3.5 text-sidebar-muted-foreground motion-reduce:animate-none', visible && 'animate-spin')}
      />
    </span>
  )
}

type SessionPinMenuItemProperties = Readonly<{
  pinned: boolean
  disabled: boolean
  onToggle(): void
}>

function SessionPinMenuItem({ pinned, disabled, onToggle }: SessionPinMenuItemProperties) {
  return (
    <DropdownItem disabled={disabled} onClick={onToggle}>
      <Bookmark aria-hidden="true" className={clsx(pinned && 'fill-current')} data-slot="icon" />
      <DropdownLabel>{pinned ? 'Unpin Session' : 'Pin Session'}</DropdownLabel>
    </DropdownItem>
  )
}

function sessionCurrentIndicatorClassName(index: number, sessionCount: number): string {
  const first = index === 0
  const last = index === sessionCount - 1

  return clsx(
    first && last && 'bg-linear-to-b from-transparent via-sidebar-foreground to-transparent',
    first && !last && 'bg-linear-to-b from-transparent via-sidebar-foreground to-sidebar-foreground',
    !first && last && 'bg-linear-to-b from-sidebar-foreground via-sidebar-foreground to-transparent'
  )
}

type SessionNavigationRowProperties = Readonly<{
  session: Workstream['sessions'][number]
  current: boolean
  titleEditing?: SessionTitleEditing
  currentIndicatorClassName: string
  icon: ReactNode
  working: boolean
  context?: string
  statusIndicator?: ReactNode
  endAction?: ReactNode
  hasWideEndAction?: boolean
  onStartTitleEditing(sessionId: SessionId): void
  onTitleChange(title: string): void
  onSaveTitle(): void
  onCancelTitleEditing(): void
  onActivateSession(sessionId: SessionId): void
  onToggleSessionPin(sessionId: SessionId): void
}>

function SessionNavigationRow({
  session,
  current,
  titleEditing,
  currentIndicatorClassName,
  icon,
  working,
  context,
  statusIndicator,
  endAction,
  hasWideEndAction = false,
  onStartTitleEditing,
  onTitleChange,
  onSaveTitle,
  onCancelTitleEditing,
  onActivateSession,
  onToggleSessionPin,
}: SessionNavigationRowProperties) {
  const inaccessible = Boolean(getSessionUnavailability(session))

  return (
    <div className="relative">
      {titleEditing?.sessionId === session.id && titleEditing.origin === 'sidebar' && !inaccessible ? (
        <div className="flex w-full items-center rounded-sm px-2 py-2 text-sm/5">
          <SessionTitleEditor
            title={titleEditing.title}
            error={titleEditing.error}
            saving={titleEditing.saving}
            onChange={onTitleChange}
            onSave={onSaveTitle}
            onCancel={onCancelTitleEditing}
          />
        </div>
      ) : (
        <SidebarItem
          current={current}
          currentIndicatorClassName={currentIndicatorClassName}
          className={clsx(
            '[&>button]:min-h-14 [&>button]:items-start [&>button]:rounded-sm! [&>button]:py-2.5 [&>button]:data-disabled:cursor-not-allowed [&>button]:data-disabled:opacity-50 *:data-[slot=current-indicator]:-left-2.25',
            hasWideEndAction ? '[&>button]:pr-14' : '[&>button]:pr-10'
          )}
          disabled={inaccessible}
          onClick={(event) => {
            if (event.shiftKey) {
              onToggleSessionPin(session.id)
              return
            }

            onActivateSession(session.id)
          }}
        >
          <SessionWorkingIcon icon={icon} working={working} />
          <SidebarLabel
            className={clsx('min-w-0 flex-1 flex flex-col font-normal', current && 'font-medium')}
            onDoubleClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              if (!inaccessible) onStartTitleEditing(session.id)
            }}
          >
            <span className="truncate">{session.title}</span>
            <span
              className={clsx(
                'text-xs/4 font-normal text-sidebar-muted-foreground',
                session.description ? 'line-clamp-4 whitespace-normal' : 'truncate'
              )}
            >
              {session.description ?? context ?? sessionContext(session)}
            </span>
          </SidebarLabel>
        </SidebarItem>
      )}

      <div className="absolute top-1/2 right-1 z-10 flex -translate-y-1/2 items-center gap-1">
        {statusIndicator}
        {endAction}
      </div>
    </div>
  )
}

type WorkstreamGroupProperties = Readonly<{
  workstream: Workstream
  activeSessionId?: SessionId
  pinnedSessionIds: readonly SessionId[]
  workingSessionIds: ReadonlySet<SessionId>
  titleEditing?: SessionTitleEditing
  initiallyOpen: boolean
  selected: boolean
  onStartTitleEditing(sessionId: SessionId): void
  onTitleChange(title: string): void
  onSaveTitle(): void
  onCancelTitleEditing(): void
  onActivateSession(sessionId: SessionId): void
  onNewSession(workstream: Workstream): void
  onSetLifecycle(workstreamId: string, lifecycle: WorkstreamLifecycle): Promise<void>
  onSelectWorkstream(workstreamId: string): void
  onToggleSessionPin(sessionId: SessionId): void
}>

type QuickSessionNavigationItemProperties = Readonly<{
  workstream: Workstream
  session: Workstream['sessions'][number]
  current: boolean
  pinned: boolean
  working: boolean
  titleEditing?: SessionTitleEditing
  currentIndicatorClassName: string
  onStartTitleEditing(sessionId: SessionId): void
  onTitleChange(title: string): void
  onSaveTitle(): void
  onCancelTitleEditing(): void
  onActivateSession(sessionId: SessionId): void
  onSetLifecycle(workstreamId: string, lifecycle: WorkstreamLifecycle): Promise<void>
  onToggleSessionPin(sessionId: SessionId): void
}>

function QuickSessionNavigationItem({
  workstream,
  session,
  current,
  pinned,
  working,
  titleEditing,
  currentIndicatorClassName,
  onStartTitleEditing,
  onTitleChange,
  onSaveTitle,
  onCancelTitleEditing,
  onActivateSession,
  onSetLifecycle,
  onToggleSessionPin,
}: QuickSessionNavigationItemProperties) {
  const [lifecycleSaving, setLifecycleSaving] = useState(false)
  const [lifecycleError, setLifecycleError] = useState<string>()
  const repositoryName = session.mode === 'default' ? session.repositoryAccess.repositoryName : 'unknown Repository'
  const inaccessible = Boolean(getSessionUnavailability(session))
  const lifecycleActionLabel = workstream.lifecycle === 'active' ? 'Archive Session' : 'Restore Session'
  const context = `${sessionContext(session)}${workstream.lifecycle === 'archived' ? ' · archived' : ''}`

  return (
    <>
      <SessionNavigationRow
        session={session}
        current={current}
        working={working}
        titleEditing={titleEditing}
        currentIndicatorClassName={currentIndicatorClassName}
        icon={<SquareTerminal aria-hidden="true" className="size-4 shrink-0 text-sidebar-muted-foreground" />}
        context={context}
        statusIndicator={
          workstream.workingLocation === 'worktrees' && (
            <span aria-label="Uses a separate worktree" title="Uses a separate worktree">
              <GitBranch aria-hidden="true" className="size-3.5 text-sidebar-muted-foreground" />
            </span>
          )
        }
        hasWideEndAction
        endAction={
          <Dropdown>
            <DropdownButton
              as="button"
              aria-label={`${session.title} in ${repositoryName} options`}
              disabled={inaccessible && !pinned}
              className="rounded-sm p-1.5 text-sidebar-muted-foreground hover:bg-sidebar-interaction hover:text-sidebar-foreground disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            >
              <Ellipsis aria-hidden="true" className="size-4" />
            </DropdownButton>
            <DropdownMenu anchor="bottom end">
              <SessionPinMenuItem
                pinned={pinned}
                disabled={inaccessible && !pinned}
                onToggle={() => onToggleSessionPin(session.id)}
              />
              <DropdownItem
                disabled={inaccessible || lifecycleSaving}
                onClick={() => {
                  const lifecycle = workstream.lifecycle === 'active' ? 'archived' : 'active'
                  setLifecycleSaving(true)
                  setLifecycleError(undefined)
                  void onSetLifecycle(workstream.id, lifecycle)
                    .catch((operationError: unknown) => {
                      setLifecycleError(
                        operationError instanceof Error ? operationError.message : 'Could not update the Session.'
                      )
                    })
                    .finally(() => setLifecycleSaving(false))
                }}
              >
                {workstream.lifecycle === 'active' ? (
                  <Archive aria-hidden="true" data-slot="icon" />
                ) : (
                  <ArchiveRestore aria-hidden="true" data-slot="icon" />
                )}
                <DropdownLabel>{lifecycleActionLabel}</DropdownLabel>
              </DropdownItem>
            </DropdownMenu>
          </Dropdown>
        }
        onStartTitleEditing={onStartTitleEditing}
        onTitleChange={onTitleChange}
        onSaveTitle={onSaveTitle}
        onCancelTitleEditing={onCancelTitleEditing}
        onActivateSession={onActivateSession}
        onToggleSessionPin={onToggleSessionPin}
      />
      {lifecycleError && (
        <p className="px-2 py-1 text-xs/5 text-form-error-foreground" role="alert">
          {lifecycleError}
        </p>
      )}
    </>
  )
}

type QuickSessionsGroupProperties = Readonly<{
  workstreams: readonly Workstream[]
  activeSessionId?: SessionId
  pinnedSessionIds: readonly SessionId[]
  workingSessionIds: ReadonlySet<SessionId>
  titleEditing?: SessionTitleEditing
  onStartTitleEditing(sessionId: SessionId): void
  onTitleChange(title: string): void
  onSaveTitle(): void
  onCancelTitleEditing(): void
  onActivateSession(sessionId: SessionId): void
  onSetLifecycle(workstreamId: string, lifecycle: WorkstreamLifecycle): Promise<void>
  onToggleSessionPin(sessionId: SessionId): void
}>

export function QuickSessionsGroup({
  workstreams,
  activeSessionId,
  pinnedSessionIds,
  workingSessionIds,
  titleEditing,
  onStartTitleEditing,
  onTitleChange,
  onSaveTitle,
  onCancelTitleEditing,
  onActivateSession,
  onSetLifecycle,
  onToggleSessionPin,
}: QuickSessionsGroupProperties) {
  const groupRef = useRef<HTMLDivElement>(null)
  const entries = workstreams.flatMap((workstream) => workstream.sessions.map((session) => ({ workstream, session })))
  const containsActiveSession = entries.some(({ session }) => session.id === activeSessionId)

  useEffect(() => {
    if (!containsActiveSession) return

    groupRef.current?.scrollIntoView({ block: 'nearest' })
  }, [containsActiveSession])

  return (
    <div ref={groupRef}>
      <SidebarSection>
        {entries.map(({ workstream, session }, sessionIndex) => {
          const currentIndicatorClassName = sessionCurrentIndicatorClassName(sessionIndex, entries.length)

          return (
            <QuickSessionNavigationItem
              key={session.id}
              workstream={workstream}
              session={session}
              current={session.id === activeSessionId}
              pinned={pinnedSessionIds.includes(session.id)}
              working={workingSessionIds.has(session.id)}
              titleEditing={titleEditing}
              currentIndicatorClassName={currentIndicatorClassName}
              onStartTitleEditing={onStartTitleEditing}
              onTitleChange={onTitleChange}
              onSaveTitle={onSaveTitle}
              onCancelTitleEditing={onCancelTitleEditing}
              onActivateSession={onActivateSession}
              onSetLifecycle={onSetLifecycle}
              onToggleSessionPin={onToggleSessionPin}
            />
          )
        })}
      </SidebarSection>
    </div>
  )
}

export function WorkstreamGroup({
  workstream,
  activeSessionId,
  pinnedSessionIds,
  workingSessionIds,
  titleEditing,
  initiallyOpen,
  selected,
  onStartTitleEditing,
  onTitleChange,
  onSaveTitle,
  onCancelTitleEditing,
  onActivateSession,
  onNewSession,
  onSetLifecycle,
  onSelectWorkstream,
  onToggleSessionPin,
}: WorkstreamGroupProperties) {
  const [open, setOpen] = useState(initiallyOpen)
  const [lifecycleSaving, setLifecycleSaving] = useState(false)
  const [lifecycleError, setLifecycleError] = useState<string>()
  const groupRef = useRef<HTMLDivElement>(null)
  const sessionsId = useId()
  const containsActiveSession = workstream.sessions.some((session) => session.id === activeSessionId)
  const workingCount = workstream.sessions.filter((session) => workingSessionIds.has(session.id)).length
  const label = workstreamLabel(workstream)
  const lifecycleTarget = workstream.goal ? 'Workstream' : 'Session'
  const lifecycleActionLabel = `${workstream.lifecycle === 'active' ? 'Archive' : 'Restore'} ${lifecycleTarget}`
  const unavailable = Boolean(workstream.unavailability)

  useEffect(() => {
    if (!containsActiveSession) return

    setOpen(true)
    groupRef.current?.scrollIntoView({ block: 'nearest' })
  }, [containsActiveSession])

  return (
    <div ref={groupRef}>
      <div
        className={clsx(
          'flex items-center gap-1 rounded-sm hover:bg-sidebar-interaction',
          selected && 'bg-sidebar-interaction'
        )}
      >
        <button
          type="button"
          aria-controls={sessionsId}
          aria-current={selected ? 'true' : undefined}
          aria-expanded={open}
          disabled={unavailable}
          className="relative flex min-w-0 flex-1 items-center gap-2 rounded-sm px-2 py-2 text-left text-sm/5 font-semibold text-sidebar-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:text-sidebar-muted-foreground data-[current=true]:after:absolute data-[current=true]:after:inset-y-2 data-[current=true]:after:left-0 data-[current=true]:after:w-0.5 data-[current=true]:after:rounded-full data-[current=true]:after:bg-sidebar-foreground"
          data-current={selected ? 'true' : undefined}
          onClick={() => {
            setOpen((current) => !current)
            onSelectWorkstream(workstream.id)
          }}
        >
          {open ? (
            <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-sidebar-muted-foreground" />
          ) : (
            <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-sidebar-muted-foreground" />
          )}
          {workstream.goal && <Workflow aria-hidden="true" className="size-4 shrink-0 text-sidebar-muted-foreground" />}
          <span className="min-w-0 flex-1 truncate">{label}</span>
          <WorkingSessionsIndicator count={workingCount} visible={!open && workingCount > 0} />
          {unavailable ? (
            <span className="text-xs/4 font-normal text-sidebar-muted-foreground">Unavailable</span>
          ) : (
            workstream.lifecycle === 'archived' && (
              <span className="text-xs/4 font-normal text-sidebar-muted-foreground">Archived</span>
            )
          )}
        </button>
        {!unavailable && workstream.lifecycle === 'active' && workstream.goal && (
          <button
            type="button"
            aria-label={`New Session in ${label}`}
            className="shrink-0 rounded-sm p-2 text-sidebar-muted-foreground hover:bg-sidebar-interaction hover:text-sidebar-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            onClick={() => onNewSession(workstream)}
          >
            <Plus aria-hidden="true" className="size-4" />
          </button>
        )}
        {!unavailable && (
          <Dropdown>
            <DropdownButton
              as="button"
              aria-label={`${label} options`}
              className="shrink-0 rounded-sm p-2 text-sidebar-muted-foreground hover:bg-sidebar-interaction hover:text-sidebar-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            >
              <Ellipsis aria-hidden="true" className="size-4" />
            </DropdownButton>
            <DropdownMenu anchor="bottom end">
              <DropdownItem
                disabled={lifecycleSaving}
                onClick={() => {
                  const lifecycle = workstream.lifecycle === 'active' ? 'archived' : 'active'
                  setLifecycleSaving(true)
                  setLifecycleError(undefined)
                  void onSetLifecycle(workstream.id, lifecycle)
                    .catch((operationError: unknown) => {
                      setLifecycleError(
                        operationError instanceof Error
                          ? operationError.message
                          : `Could not update the ${lifecycleTarget}.`
                      )
                    })
                    .finally(() => setLifecycleSaving(false))
                }}
              >
                {workstream.lifecycle === 'active' ? (
                  <Archive aria-hidden="true" data-slot="icon" />
                ) : (
                  <ArchiveRestore aria-hidden="true" data-slot="icon" />
                )}
                <DropdownLabel>{lifecycleActionLabel}</DropdownLabel>
              </DropdownItem>
            </DropdownMenu>
          </Dropdown>
        )}
      </div>
      {workstream.unavailability && (
        <p className="px-2 py-1 text-xs/5 text-form-error-foreground" role="alert">
          {workstream.unavailability}
        </p>
      )}
      {lifecycleError && (
        <p className="px-2 py-1 text-xs/5 text-form-error-foreground" role="alert">
          {lifecycleError}
        </p>
      )}

      {open && (
        <div id={sessionsId} className={sessionListClassName}>
          <SidebarSection>
            {workstream.sessions.map((session, sessionIndex) => {
              const ModeIcon =
                session.mode === 'default' ? SquareTerminal : session.mode === 'brainstorm' ? Telescope : Hammer
              const pinned = pinnedSessionIds.includes(session.id)
              const inaccessible = Boolean(getSessionUnavailability(session))

              return (
                <SessionNavigationRow
                  key={session.id}
                  session={session}
                  current={session.id === activeSessionId}
                  working={workingSessionIds.has(session.id)}
                  titleEditing={titleEditing}
                  currentIndicatorClassName={sessionCurrentIndicatorClassName(sessionIndex, workstream.sessions.length)}
                  icon={<ModeIcon aria-hidden="true" className="size-4 shrink-0 text-sidebar-muted-foreground" />}
                  endAction={
                    <Dropdown>
                      <DropdownButton
                        as="button"
                        aria-label={`${session.title} options`}
                        disabled={inaccessible && !pinned}
                        className="rounded-sm p-1.5 text-sidebar-muted-foreground hover:bg-sidebar-interaction hover:text-sidebar-foreground disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                      >
                        <Ellipsis aria-hidden="true" className="size-4" />
                      </DropdownButton>
                      <DropdownMenu anchor="bottom end">
                        <SessionPinMenuItem
                          pinned={pinned}
                          disabled={inaccessible && !pinned}
                          onToggle={() => onToggleSessionPin(session.id)}
                        />
                      </DropdownMenu>
                    </Dropdown>
                  }
                  onStartTitleEditing={onStartTitleEditing}
                  onTitleChange={onTitleChange}
                  onSaveTitle={onSaveTitle}
                  onCancelTitleEditing={onCancelTitleEditing}
                  onActivateSession={onActivateSession}
                  onToggleSessionPin={onToggleSessionPin}
                />
              )
            })}
          </SidebarSection>
        </div>
      )}
    </div>
  )
}
