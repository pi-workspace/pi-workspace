import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { SidebarLayout } from '@/components/ui-kit/sidebar-layout'
import type { WorkspaceMembershipUpdate, WorkspacesSnapshot } from '@/src/application-state'
import type { SessionMessageSubmission } from '@/src/composer'
import type { SessionId } from '@/src/domain/session'
import type {
  CreateQuickSessionOptions,
  CreateSessionOptions,
  CreateWorkstreamOptions,
  ForkSessionOptions,
  WorkstreamsSnapshot,
} from '@/src/domain/workstream'
import { bundledReleaseNotes } from '@/src/release-notes'
import { SessionArea } from '@/src/renderer/components/session-area'
import { WorkstreamContextLayout, WorkstreamSelectionScreen } from '@/src/renderer/components/workstream-context'
import type { SessionChangesSelection } from '@/src/renderer/components/session-changes'
import { WorkspaceNavigation } from '@/src/renderer/components/workspace-navigation'
import { WorkstreamNavigation } from '@/src/renderer/components/workstream-navigation'
import { initialMainContentState, updateMainContent } from '@/src/renderer/main-content'
import { ChangelogScreen } from '@/src/renderer/screens/changelog-screen'
import { StartupScreen } from '@/src/renderer/screens/startup-screen'
import { WorkstreamsLoadScreen } from '@/src/renderer/screens/workstreams-load-screen'
import { getVisibleSessionIds, updateSessionPinning, type SessionPinningState } from '@/src/renderer/session-pinning'
import { useWorkingSessionIds } from '@/src/renderer/session-transcript-state'
import { initialWorkstreamSelection, updateWorkstreamSelection } from '@/src/renderer/workstream-selection'
import { normalizeSessionTitle } from '@/src/session-title'

const initialSessionPinningState: SessionPinningState = {
  pinnedSessionIds: [],
}

type SessionTitleEditing = Readonly<{
  sessionId: SessionId
  title: string
  publishedTitle: string
  origin: 'header' | 'sidebar'
  error?: string
  saving: boolean
}>

type WorkspaceShellProperties = Readonly<{
  initialWorkspacesSnapshot: WorkspacesSnapshot
  initialSessionDisplay?: Readonly<{
    activeSessionId: SessionId
    pinnedSessionIds: readonly SessionId[]
    drafts?: ReadonlyMap<SessionId, string>
  }>
}>

type SelectedWorkspaceAuthorityToken = Readonly<{
  workspaceId: string
  generation: number
}>

export function WorkspaceShell({ initialWorkspacesSnapshot, initialSessionDisplay }: WorkspaceShellProperties) {
  const [workspacesSnapshot, setWorkspacesSnapshot] = useState(initialWorkspacesSnapshot)
  const initialWorkspaceId = initialWorkspacesSnapshot.workspaces[0]?.id
  const [workstreamsSnapshot, setWorkstreamsSnapshot] = useState<WorkstreamsSnapshot>()
  const [workstreamsLoadError, setWorkstreamsLoadError] = useState<string>()
  const [workstreamsLoadAttempt, setWorkstreamsLoadAttempt] = useState(0)
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState(initialWorkspaceId)
  const selectedWorkspaceIdRef = useRef(initialWorkspaceId)
  const workspaceSelectionGenerationRef = useRef(0)
  const workstreamsSnapshotRef = useRef<WorkstreamsSnapshot | undefined>(undefined)
  const [workstreamSelection, dispatchWorkstreamSelection] = useReducer(
    updateWorkstreamSelection,
    initialWorkstreamSelection
  )
  const [sessionPinning, dispatchSessionPinning] = useReducer(
    updateSessionPinning,
    initialSessionDisplay ? { pinnedSessionIds: initialSessionDisplay.pinnedSessionIds } : initialSessionPinningState
  )
  const initialSessionDisplayRef = useRef(initialSessionDisplay)
  const [mainContent, dispatchMainContent] = useReducer(updateMainContent, initialMainContentState)
  const changelogButtonRef = useRef<HTMLElement>(null)
  const draftsRef = useRef(new Map(initialSessionDisplay?.drafts))
  const sessionTitleSavePending = useRef(false)
  const composerFocusRequestNumber = useRef(0)
  const [workstreamCreationRequest, setWorkstreamCreationRequest] = useState<number>()
  const [quickSessionCreationRequest, setQuickSessionCreationRequest] = useState<number>()
  const [composerFocusRequest, setComposerFocusRequest] = useState<
    Readonly<{ sessionId: SessionId; request: number }> | undefined
  >()
  const [sessionRevealRequest, setSessionRevealRequest] = useState<
    Readonly<{ sessionId: SessionId; request: number }> | undefined
  >()
  const [sessionTitleEditing, setSessionTitleEditing] = useState<SessionTitleEditing>()
  const changesRequestNumber = useRef(0)
  const [changesSelection, setChangesSelection] = useState<
    (SessionChangesSelection & Readonly<{ sessionId: SessionId }>) | undefined
  >()

  const selectedWorkspaceAuthorityToken = (): SelectedWorkspaceAuthorityToken => {
    const workspaceId = selectedWorkspaceIdRef.current

    if (!workspaceId) throw new Error('Select a Workspace first.')

    return { workspaceId, generation: workspaceSelectionGenerationRef.current }
  }

  const applyWorkstreamsSnapshot = (token: SelectedWorkspaceAuthorityToken, snapshot: WorkstreamsSnapshot): boolean => {
    if (
      selectedWorkspaceIdRef.current !== token.workspaceId ||
      workspaceSelectionGenerationRef.current !== token.generation
    ) {
      return false
    }

    if (workstreamsSnapshotRef.current && snapshot.revision < workstreamsSnapshotRef.current.revision) return false

    workstreamsSnapshotRef.current = snapshot
    setWorkstreamsSnapshot(snapshot)
    return true
  }

  useEffect(() => {
    return window.piWorkspace.workstreams.subscribe((snapshot) => {
      const workspaceId = selectedWorkspaceIdRef.current

      if (!workspaceId || !snapshot.workstreams.some((workstream) => workstream.workspaceId === workspaceId)) return

      applyWorkstreamsSnapshot({ workspaceId, generation: workspaceSelectionGenerationRef.current }, snapshot)
    })
  }, [])

  useEffect(() => {
    if (!selectedWorkspaceId) return

    selectedWorkspaceIdRef.current = selectedWorkspaceId
    const authorityToken = selectedWorkspaceAuthorityToken()
    let active = true
    workstreamsSnapshotRef.current = undefined
    setWorkstreamsSnapshot(undefined)
    setWorkstreamsLoadError(undefined)
    dispatchWorkstreamSelection({ type: 'start-workspace-load' })

    void window.piWorkspace.workstreams
      .getSnapshot(selectedWorkspaceId)
      .then((snapshot) => {
        if (!active || !applyWorkstreamsSnapshot(authorityToken, snapshot)) return

        const initialDisplay = initialSessionDisplayRef.current
        initialSessionDisplayRef.current = undefined
        if (!initialDisplay) return

        const owningWorkstream = snapshot.workstreams.find((workstream) =>
          workstream.sessions.some((session) => session.id === initialDisplay.activeSessionId)
        )
        if (owningWorkstream) {
          dispatchWorkstreamSelection({
            type: 'select-session',
            workstreamId: owningWorkstream.id,
            sessionId: initialDisplay.activeSessionId,
          })
        }
      })
      .catch((error: unknown) => {
        if (
          !active ||
          selectedWorkspaceIdRef.current !== authorityToken.workspaceId ||
          workspaceSelectionGenerationRef.current !== authorityToken.generation
        ) {
          return
        }

        const message = error instanceof Error ? error.message : 'Application authority is unavailable.'
        setWorkstreamsLoadError(message)
        console.error('Unable to load Workstreams.', error)
      })

    return () => {
      active = false
    }
  }, [selectedWorkspaceId, workstreamsLoadAttempt])

  const handleSessionRevealed = useCallback((sessionId: SessionId) => {
    composerFocusRequestNumber.current += 1
    setComposerFocusRequest({ sessionId, request: composerFocusRequestNumber.current })
  }, [])

  const workstreams = workstreamsSnapshot?.workstreams ?? []
  const selectedWorkstream = workstreams.find((workstream) => workstream.id === workstreamSelection.workstreamId)

  const selectedWorkspace = workspacesSnapshot.workspaces.find((workspace) => workspace.id === selectedWorkspaceId)
  const repositories = selectedWorkspace?.repositories ?? []
  const sessions = workstreams.flatMap((workstream) => workstream.sessions)
  const workingSessionIds = useWorkingSessionIds(
    selectedWorkspaceId,
    sessions.map((session) => session.id)
  )
  const workstreamLifecycles = new Map(workstreams.map((workstream) => [workstream.id, workstream.lifecycle]))
  const workstreamWorkingLocations = new Map(
    workstreams.map((workstream) => [workstream.id, workstream.workingLocation])
  )
  const recentSessions = sessions.slice(-5).reverse()
  const visibleSessionIds = getVisibleSessionIds(sessionPinning, workstreamSelection.sessionId)
  const activeSession = sessions.find((session) => session.id === workstreamSelection.sessionId)
  const visibleSessions = visibleSessionIds.flatMap((ownedSessionId) => {
    const ownedSession = sessions.find((candidate) => candidate.id === ownedSessionId)
    return ownedSession ? [ownedSession] : []
  })

  const activateSession = (sessionId: SessionId) => {
    const owningWorkstream = workstreams.find((workstream) =>
      workstream.sessions.some((session) => session.id === sessionId)
    )

    if (!owningWorkstream) return

    dispatchMainContent({ type: 'activate-session' })
    dispatchWorkstreamSelection({ type: 'select-session', workstreamId: owningWorkstream.id, sessionId })
  }

  const selectWorkstream = (workstreamId: string) => {
    dispatchMainContent({ type: 'activate-session' })
    dispatchWorkstreamSelection({ type: 'select-workstream', workstreamId })
  }

  const revealCreatedSession = (snapshot: WorkstreamsSnapshot, sessionId: SessionId) => {
    const owningWorkstream = snapshot.workstreams.find((workstream) =>
      workstream.sessions.some((session) => session.id === sessionId)
    )

    if (!owningWorkstream) return

    dispatchMainContent({ type: 'activate-session' })
    dispatchWorkstreamSelection({ type: 'select-session', workstreamId: owningWorkstream.id, sessionId })
    composerFocusRequestNumber.current += 1
    const request = composerFocusRequestNumber.current
    setComposerFocusRequest(undefined)

    // The creation dialog restores focus to its trigger as it closes. Defer the
    // reveal until that restoration has completed so it cannot take focus back
    // from the Composer.
    window.requestAnimationFrame(() => {
      setSessionRevealRequest({ sessionId, request })
    })
  }

  const openCurrentDiff = (sessionId: SessionId, repositoryId: string | undefined, path: string) => {
    activateSession(sessionId)
    changesRequestNumber.current += 1
    setChangesSelection({ sessionId, repositoryId, path, request: changesRequestNumber.current })
  }

  const toggleSessionPin = (sessionId: SessionId) => {
    dispatchSessionPinning({ type: 'toggle-pin', sessionId })
  }

  const openChangelog = () => {
    dispatchMainContent({ type: 'open-changelog' })
  }

  const returnToStartup = () => {
    dispatchMainContent({ type: 'return-to-startup' })
    requestAnimationFrame(() => changelogButtonRef.current?.focus())
  }

  const updateDraft = useCallback((sessionId: SessionId, draft: string) => {
    if (draft) draftsRef.current.set(sessionId, draft)
    else draftsRef.current.delete(sessionId)
  }, [])

  const submitMessage = (submission: SessionMessageSubmission) => window.piWorkspace.composer.submit(submission)
  const stopRun = (sessionId: SessionId) => window.piWorkspace.composer.stop(sessionId)
  const removeQueuedFollowUp = (sessionId: SessionId, followUpId: string) =>
    window.piWorkspace.composer.removeQueuedFollowUp(sessionId, followUpId)
  const resumeQueuedFollowUps = (sessionId: SessionId) => window.piWorkspace.composer.resumeQueuedFollowUps(sessionId)

  const startTitleEditing = (sessionId: SessionId, origin: 'header' | 'sidebar') => {
    const session = sessions.find((candidate) => candidate.id === sessionId)

    if (session) {
      setSessionTitleEditing({ sessionId, title: session.title, publishedTitle: session.title, origin, saving: false })
    }
  }

  const saveTitle = async () => {
    if (!sessionTitleEditing || sessionTitleEditing.saving || sessionTitleSavePending.current) return

    const title = normalizeSessionTitle(sessionTitleEditing.title)

    if (!title) {
      setSessionTitleEditing((current) =>
        current ? { ...current, error: 'Enter a title with visible characters.' } : current
      )
      return
    }

    if (title === sessionTitleEditing.publishedTitle) {
      setSessionTitleEditing(undefined)
      return
    }

    sessionTitleSavePending.current = true
    setSessionTitleEditing((current) => (current ? { ...current, error: undefined, saving: true } : current))

    const authorityToken = selectedWorkspaceAuthorityToken()

    try {
      const snapshot = await window.piWorkspace.workstreams.renameSession(sessionTitleEditing.sessionId, title)

      if (applyWorkstreamsSnapshot(authorityToken, snapshot)) {
        setSessionTitleEditing(undefined)
      }
    } catch (error) {
      if (
        selectedWorkspaceIdRef.current !== authorityToken.workspaceId ||
        workspaceSelectionGenerationRef.current !== authorityToken.generation
      ) {
        return
      }

      const detail = error instanceof Error && error.message.length > 0 ? ` ${error.message}` : ''

      setSessionTitleEditing((current) =>
        current?.sessionId === sessionTitleEditing.sessionId
          ? { ...current, error: `Could not save the title.${detail}`, saving: false }
          : current
      )
    } finally {
      sessionTitleSavePending.current = false
    }
  }

  const previewWorktreeLocations = (repositoryId: string) => {
    const authorityToken = selectedWorkspaceAuthorityToken()

    return window.piWorkspace.workstreams.previewWorktreeLocations(authorityToken.workspaceId, repositoryId)
  }

  const createWorkstream = async (options: CreateWorkstreamOptions) => {
    const authorityToken = selectedWorkspaceAuthorityToken()
    const outcome = await window.piWorkspace.workstreams.createWorkstream(authorityToken.workspaceId, options)

    if (applyWorkstreamsSnapshot(authorityToken, outcome.snapshot)) {
      revealCreatedSession(outcome.snapshot, outcome.sessionId)
    }
  }

  const createQuickSession = async (options: CreateQuickSessionOptions) => {
    const authorityToken = selectedWorkspaceAuthorityToken()
    const outcome = await window.piWorkspace.workstreams.createQuickSession(authorityToken.workspaceId, options)

    if (applyWorkstreamsSnapshot(authorityToken, outcome.snapshot)) {
      revealCreatedSession(outcome.snapshot, outcome.sessionId)
    }
  }

  const createSession = async (workstreamId: string, options: CreateSessionOptions) => {
    const authorityToken = selectedWorkspaceAuthorityToken()
    const outcome = await window.piWorkspace.workstreams.createSession(workstreamId, options)

    if (applyWorkstreamsSnapshot(authorityToken, outcome.snapshot)) {
      revealCreatedSession(outcome.snapshot, outcome.sessionId)
    }
  }

  const forkSession = async (sourceSessionId: SessionId, options: ForkSessionOptions) => {
    const authorityToken = selectedWorkspaceAuthorityToken()
    const outcome = await window.piWorkspace.workstreams.forkSession(sourceSessionId, options)

    if (!applyWorkstreamsSnapshot(authorityToken, outcome.snapshot)) return

    draftsRef.current.set(outcome.sessionId, outcome.draft)
    revealCreatedSession(outcome.snapshot, outcome.sessionId)
  }

  const setWorkstreamLifecycle = async (workstreamId: string, lifecycle: 'active' | 'archived') => {
    const authorityToken = selectedWorkspaceAuthorityToken()
    const snapshot = await window.piWorkspace.workstreams.setLifecycle(workstreamId, lifecycle)
    applyWorkstreamsSnapshot(authorityToken, snapshot)
  }

  const createWorkspace = async (name: string) => {
    const outcome = await window.piWorkspace.applicationState.createWorkspace(name)

    if (outcome.status === 'created') setWorkspacesSnapshot(outcome.snapshot)
  }

  const renameWorkspace = async (workspaceId: string, name: string) => {
    setWorkspacesSnapshot(await window.piWorkspace.applicationState.renameWorkspace(workspaceId, name))
  }

  const addWorkspaceRepositories = async (workspaceId: string) => {
    const outcome = await window.piWorkspace.applicationState.addWorkspaceRepositories(workspaceId)

    if (outcome.status === 'created') setWorkspacesSnapshot(outcome.snapshot)
  }

  const removeWorkspaceRepository = async (workspaceId: string, membershipId: string) => {
    setWorkspacesSnapshot(
      await window.piWorkspace.applicationState.removeWorkspaceRepository(workspaceId, membershipId)
    )
  }

  const updateWorkspaceMembership = async (
    workspaceId: string,
    membershipId: string,
    update: WorkspaceMembershipUpdate
  ) => {
    setWorkspacesSnapshot(
      await window.piWorkspace.applicationState.updateWorkspaceMembership(workspaceId, membershipId, update)
    )
  }

  const selectWorkspace = (workspaceId: string) => {
    if (workspaceId === selectedWorkspaceId) return

    selectedWorkspaceIdRef.current = workspaceId
    workspaceSelectionGenerationRef.current += 1
    workstreamsSnapshotRef.current = undefined
    setWorkstreamsSnapshot(undefined)
    dispatchSessionPinning({ type: 'reset' })
    dispatchWorkstreamSelection({ type: 'start-workspace-load' })
    draftsRef.current = new Map()
    setSessionTitleEditing(undefined)
    setSelectedWorkspaceId(workspaceId)
  }

  return (
    <SidebarLayout
      sidebar={
        <WorkspaceNavigation
          onAddRepositories={addWorkspaceRepositories}
          onCreateWorkspace={createWorkspace}
          onRemoveRepository={removeWorkspaceRepository}
          onRenameWorkspace={renameWorkspace}
          onSelectWorkspace={selectWorkspace}
          onUpdateMembership={updateWorkspaceMembership}
          applicationVersion={bundledReleaseNotes[0]?.version ?? 'Unknown'}
          onOpenChangelog={openChangelog}
          selectedWorkspaceId={selectedWorkspaceId}
          workspaces={workspacesSnapshot.workspaces}
        >
          <WorkstreamNavigation
            activeSessionId={workstreamSelection.sessionId}
            selectedWorkstreamId={workstreamSelection.workstreamId}
            createRequest={workstreamCreationRequest}
            quickSessionCreateRequest={quickSessionCreationRequest}
            loading={!workstreamsSnapshot && !workstreamsLoadError}
            loadError={workstreamsLoadError}
            pinnedSessionIds={sessionPinning.pinnedSessionIds}
            repositories={repositories}
            titleEditing={sessionTitleEditing}
            workingSessionIds={workingSessionIds}
            workstreams={workstreams}
            onStartTitleEditing={(sessionId) => startTitleEditing(sessionId, 'sidebar')}
            onTitleChange={(title) =>
              setSessionTitleEditing((current) => (current ? { ...current, title, error: undefined } : current))
            }
            onSaveTitle={() => void saveTitle()}
            onCancelTitleEditing={() => setSessionTitleEditing(undefined)}
            onActivateSession={activateSession}
            onCreateWorkstream={createWorkstream}
            onCreateQuickSession={createQuickSession}
            onCreateSession={createSession}
            onPreviewWorktreeLocations={previewWorktreeLocations}
            onSetWorkstreamLifecycle={setWorkstreamLifecycle}
            onSelectWorkstream={selectWorkstream}
            onToggleSessionPin={toggleSessionPin}
          />
        </WorkspaceNavigation>
      }
    >
      <WorkstreamContextLayout
        activeSession={activeSession}
        changesSelection={changesSelection?.sessionId === activeSession?.id ? changesSelection : undefined}
      >
        {!workstreamsSnapshot ? (
          <WorkstreamsLoadScreen
            error={workstreamsLoadError}
            onRetry={() => setWorkstreamsLoadAttempt((attempt) => attempt + 1)}
          />
        ) : mainContent.destination === 'changelog' ? (
          <ChangelogScreen releaseNotes={bundledReleaseNotes} onBack={returnToStartup} />
        ) : visibleSessions.length > 0 ? (
          <SessionArea
            sessions={visibleSessions}
            workstreamLifecycles={workstreamLifecycles}
            workstreamWorkingLocations={workstreamWorkingLocations}
            activeSessionId={workstreamSelection.sessionId}
            revealRequest={sessionRevealRequest}
            composerFocusRequest={composerFocusRequest}
            drafts={draftsRef.current}
            titleEditing={sessionTitleEditing}
            onSessionRevealed={handleSessionRevealed}
            onStartTitleEditing={(sessionId) => startTitleEditing(sessionId, 'header')}
            onTitleChange={(title) =>
              setSessionTitleEditing((current) => (current ? { ...current, title, error: undefined } : current))
            }
            onSaveTitle={() => void saveTitle()}
            onCancelTitleEditing={() => setSessionTitleEditing(undefined)}
            pinnedSessionIds={sessionPinning.pinnedSessionIds}
            onActivateSession={activateSession}
            onDraftChange={updateDraft}
            submitMessage={submitMessage}
            stopRun={stopRun}
            removeQueuedFollowUp={removeQueuedFollowUp}
            resumeQueuedFollowUps={resumeQueuedFollowUps}
            sessionConfiguration={window.piWorkspace.sessionConfiguration}
            sessionSkills={window.piWorkspace.sessionSkills}
            sessionFiles={window.piWorkspace.sessionFiles}
            sessionWorkingLocations={window.piWorkspace.sessionWorkingLocations}
            getSessionForkPoints={(sessionId) => window.piWorkspace.workstreams.getSessionForkPoints(sessionId)}
            forkSession={forkSession}
            onToggleSessionPin={toggleSessionPin}
            acceptActionCard={window.piWorkspace.transcript.acceptActionCard}
            onStartImplementSession={(workstreamId) => createSession(workstreamId, { mode: 'implement' })}
            onOpenCurrentDiff={openCurrentDiff}
          />
        ) : selectedWorkstream?.goal ? (
          <WorkstreamSelectionScreen workstream={selectedWorkstream} />
        ) : (
          <StartupScreen
            recentSessions={recentSessions}
            onActivateSession={activateSession}
            onCreateWorkstream={() => setWorkstreamCreationRequest((request) => (request ?? 0) + 1)}
            onCreateQuickSession={() => setQuickSessionCreationRequest((request) => (request ?? 0) + 1)}
            onOpenChangelog={openChangelog}
            changelogButtonRef={changelogButtonRef}
          />
        )}
      </WorkstreamContextLayout>
    </SidebarLayout>
  )
}
