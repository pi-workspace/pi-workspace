import { useEffect, useState } from 'react'
import type { ApplicationStateStartup, WorkspacesSnapshot } from '@/src/application-state'
import type { SessionId } from '@/src/domain/session'
import { ApplicationLoadScreen } from '@/src/renderer/screens/application-load-screen'
import { RecoveryScreen } from '@/src/renderer/screens/recovery-screen'
import { WorkspaceOnboardingScreen } from '@/src/renderer/screens/workspace-onboarding-screen'
import { WorkspaceShell } from '@/src/renderer/workspace-shell'

type BootstrapFailure = Readonly<{
  stage: 'startup' | 'workspaces'
  message: string
}>

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Application authority is unavailable.'
}

export type AppProperties = Readonly<{
  initialSessionDisplay?: Readonly<{
    activeSessionId: SessionId
    pinnedSessionIds: readonly SessionId[]
  }>
}>

export function App({ initialSessionDisplay }: AppProperties = {}) {
  const [applicationStartup, setApplicationStartup] = useState<ApplicationStateStartup>()
  const [workspacesSnapshot, setWorkspacesSnapshot] = useState<WorkspacesSnapshot>()
  const [failure, setFailure] = useState<BootstrapFailure>()
  const [startupAttempt, setStartupAttempt] = useState(0)
  const [workspacesAttempt, setWorkspacesAttempt] = useState(0)

  useEffect(() => {
    let active = true

    setFailure(undefined)
    void window.piWorkspace.applicationState
      .getStartup()
      .then((startup) => {
        if (active) setApplicationStartup(startup)
      })
      .catch((error: unknown) => {
        if (active) setFailure({ stage: 'startup', message: errorMessage(error) })
      })

    return () => {
      active = false
    }
  }, [startupAttempt])

  useEffect(() => {
    if (!applicationStartup || applicationStartup.status === 'recovery-only') return

    let active = true

    setFailure(undefined)
    void window.piWorkspace.applicationState
      .getWorkspaces()
      .then((snapshot) => {
        if (active) setWorkspacesSnapshot(snapshot)
      })
      .catch((error: unknown) => {
        if (active) setFailure({ stage: 'workspaces', message: errorMessage(error) })
      })

    return () => {
      active = false
    }
  }, [applicationStartup, workspacesAttempt])

  if (failure?.stage === 'startup') {
    return (
      <ApplicationLoadScreen
        title="Could not start Pi Workspace"
        error={failure.message}
        onRetry={() => {
          setApplicationStartup(undefined)
          setStartupAttempt((attempt) => attempt + 1)
        }}
      />
    )
  }

  if (!applicationStartup) return <ApplicationLoadScreen title="Starting Pi Workspace" />

  if (applicationStartup.status === 'recovery-only') {
    return (
      <RecoveryScreen
        startup={applicationStartup}
        onReset={async () => setApplicationStartup(await window.piWorkspace.applicationState.getStartup())}
      />
    )
  }

  if (failure?.stage === 'workspaces') {
    return (
      <ApplicationLoadScreen
        title="Could not load Workspaces"
        error={failure.message}
        onRetry={() => setWorkspacesAttempt((attempt) => attempt + 1)}
      />
    )
  }

  if (!workspacesSnapshot) return <ApplicationLoadScreen title="Loading Workspaces" />

  if (workspacesSnapshot.workspaces.length === 0) {
    return (
      <WorkspaceOnboardingScreen
        onCreateWorkspace={async (name) => {
          const outcome = await window.piWorkspace.applicationState.createWorkspace(name)
          if (outcome.status === 'created') setWorkspacesSnapshot(outcome.snapshot)
        }}
      />
    )
  }

  return <WorkspaceShell initialWorkspacesSnapshot={workspacesSnapshot} initialSessionDisplay={initialSessionDisplay} />
}
