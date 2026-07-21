import { useEffect, useRef } from 'react'
import type { ComposerBridge } from '@/src/composer'
import type { SessionId } from '@/src/domain/session'
import type { OwnedSession, WorkstreamLifecycle } from '@/src/domain/workstream'
import type { SessionConfigurationBridge } from '@/src/session-configuration'
import { SessionContainer } from '@/src/renderer/components/session-container'

type SessionAreaProperties = {
  sessions: readonly OwnedSession[]
  workstreamLifecycles?: ReadonlyMap<string, WorkstreamLifecycle>
  activeSessionId?: SessionId
  revealRequest?: Readonly<{ sessionId: SessionId; request: number }>
  composerFocusRequest?: Readonly<{ sessionId: SessionId; request: number }>
  drafts: ReadonlyMap<SessionId, string>
  pinnedSessionIds: readonly SessionId[]
  titleEditing?: Readonly<{
    sessionId: SessionId
    title: string
    error?: string
    saving: boolean
    origin: 'header' | 'sidebar'
  }>
  onSessionRevealed?: (sessionId: SessionId) => void
  onStartTitleEditing?: (sessionId: SessionId) => void
  onTitleChange?: (title: string) => void
  onSaveTitle?: () => void
  onCancelTitleEditing?: () => void
  onActivateSession: (sessionId: SessionId) => void
  onDraftChange: (sessionId: SessionId, draft: string) => void
  submitMessage: ComposerBridge['submit']
  stopRun?: ComposerBridge['stop']
  sessionConfiguration?: SessionConfigurationBridge
  onToggleSessionPin: (sessionId: SessionId) => void
}

export function SessionArea({
  sessions,
  workstreamLifecycles = new Map(),
  activeSessionId,
  revealRequest,
  composerFocusRequest,
  drafts,
  titleEditing,
  onSessionRevealed = () => {},
  onStartTitleEditing = () => {},
  onTitleChange = () => {},
  onSaveTitle = () => {},
  onCancelTitleEditing = () => {},
  pinnedSessionIds,
  onActivateSession,
  onDraftChange,
  submitMessage,
  stopRun,
  sessionConfiguration,
  onToggleSessionPin,
}: SessionAreaProperties) {
  const sessionPaneRefs = useRef(new Map<SessionId, HTMLDivElement>())

  useEffect(() => {
    if (!revealRequest) {
      return
    }

    const pane = sessionPaneRefs.current.get(revealRequest.sessionId)

    if (!pane) {
      return
    }

    pane.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    onSessionRevealed(revealRequest.sessionId)
  }, [revealRequest?.request, revealRequest?.sessionId])

  return (
    <div className="flex min-h-0 min-w-0 flex-1 overflow-x-auto overflow-y-hidden">
      {sessions.map((session) => (
        <div
          key={session.id}
          ref={(pane) => {
            if (pane) {
              sessionPaneRefs.current.set(session.id, pane)
            } else {
              sessionPaneRefs.current.delete(session.id)
            }
          }}
          className="flex min-h-0 min-w-[400px] flex-[1_0_400px] border-r border-content-border last:border-r-0"
        >
          <SessionContainer
            session={session}
            workstreamLifecycle={workstreamLifecycles.get(session.workstreamId) ?? 'active'}
            active={session.id === activeSessionId}
            draft={drafts.get(session.id) ?? ''}
            composerFocusRequest={
              composerFocusRequest?.sessionId === session.id ? composerFocusRequest.request : undefined
            }
            pinned={pinnedSessionIds.includes(session.id)}
            titleEditing={titleEditing?.sessionId === session.id ? titleEditing : undefined}
            onStartTitleEditing={() => onStartTitleEditing(session.id)}
            onTitleChange={onTitleChange}
            onSaveTitle={onSaveTitle}
            onCancelTitleEditing={onCancelTitleEditing}
            onActivate={() => onActivateSession(session.id)}
            onDraftChange={(draft) => onDraftChange(session.id, draft)}
            submitMessage={submitMessage}
            stopRun={stopRun}
            sessionConfiguration={sessionConfiguration}
            onTogglePin={() => onToggleSessionPin(session.id)}
          />
        </div>
      ))}
    </div>
  )
}
