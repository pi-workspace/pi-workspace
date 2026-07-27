import { useId } from 'react'
import { LockKeyhole, Pencil, TriangleAlert } from 'lucide-react'
import type { ComposerBridge } from '@/src/composer'
import type { OwnedSession, WorkstreamLifecycle } from '@/src/domain/workstream'
import type { SessionConfigurationBridge } from '@/src/session-configuration'
import type { SessionSkillsBridge } from '@/src/session-skills'
import type { SessionActionCard } from '@/src/session-action-cards'
import type { SessionTranscriptBridge } from '@/src/session-transcript'
import { Composer } from '@/src/renderer/components/composer'
import { QueuedFollowUpTray } from '@/src/renderer/components/queued-follow-up-tray'
import { SessionMessages } from '@/src/renderer/components/session-messages'
import { SessionPinButton } from '@/src/renderer/components/session-pin-button'
import { SessionTitleEditor } from '@/src/renderer/components/session-title-editor'
import { getSessionUnavailability } from '@/src/renderer/session-availability'
import { useSessionTranscript } from '@/src/renderer/session-transcript-state'

type SessionContainerProperties = {
  session: OwnedSession
  workstreamLifecycle: WorkstreamLifecycle
  active: boolean
  draft: string
  composerFocusRequest?: number
  pinned: boolean
  titleEditing?: Readonly<{ title: string; error?: string; saving: boolean; origin: 'header' | 'sidebar' }>
  onStartTitleEditing: () => void
  onTitleChange: (title: string) => void
  onSaveTitle: () => void
  onCancelTitleEditing: () => void
  onActivate: () => void
  onDraftChange: (draft: string) => void
  submitMessage: ComposerBridge['submit']
  stopRun?: ComposerBridge['stop']
  removeQueuedFollowUp?: NonNullable<ComposerBridge['removeQueuedFollowUp']>
  resumeQueuedFollowUps?: NonNullable<ComposerBridge['resumeQueuedFollowUps']>
  sessionConfiguration?: SessionConfigurationBridge
  sessionSkills?: SessionSkillsBridge
  onTogglePin: () => void
  acceptActionCard?: SessionTranscriptBridge['acceptActionCard']
  dismissActionCard?: SessionTranscriptBridge['dismissActionCard']
  onStartImplementSession?: (workstreamId: string) => Promise<void>
}

export function SessionContainer({
  session,
  workstreamLifecycle,
  active,
  draft,
  composerFocusRequest,
  pinned,
  titleEditing,
  onStartTitleEditing,
  onTitleChange,
  onSaveTitle,
  onCancelTitleEditing,
  onActivate,
  onDraftChange,
  submitMessage,
  stopRun,
  removeQueuedFollowUp,
  resumeQueuedFollowUps,
  sessionConfiguration,
  sessionSkills,
  onTogglePin,
  acceptActionCard = async () => false,
  dismissActionCard = async () => false,
  onStartImplementSession = async () => {},
}: SessionContainerProperties) {
  const headingId = useId()
  const transcriptState = useSessionTranscript(session.id)
  const isWorking = transcriptState.snapshot?.isWorking ?? false
  const unavailability = getSessionUnavailability(session)
  const composerUnavailable = Boolean(unavailability) || workstreamLifecycle === 'archived'
  const modeLabel =
    session.mode === 'default'
      ? session.repositoryAccess.repositoryName
      : session.mode === 'brainstorm'
        ? 'Brainstorm'
        : 'Implement'

  return (
    <section
      aria-labelledby={headingId}
      className="session-pane flex min-h-0 min-w-0 flex-1 flex-col bg-content-background"
      onClick={() => {
        if (!unavailability) onActivate()
      }}
    >
      <header
        className="group/title flex h-18 shrink-0 items-center gap-3 border-b border-content-border px-6 py-4 transition-colors duration-150 motion-reduce:transition-none data-[active=true]:bg-session-header-active-background"
        data-active={active ? 'true' : undefined}
      >
        {titleEditing?.origin === 'header' && !unavailability ? (
          <>
            <h1 id={headingId} className="sr-only">
              {session.title}
            </h1>
            <SessionTitleEditor
              title={titleEditing.title}
              error={titleEditing.error}
              saving={titleEditing.saving}
              onChange={onTitleChange}
              onSave={onSaveTitle}
              onCancel={onCancelTitleEditing}
            />
          </>
        ) : (
          <>
            <div className="min-w-0">
              <h1
                id={headingId}
                className={`truncate text-sm/6 text-content-foreground ${active ? 'font-semibold' : 'font-medium'}`}
              >
                {session.title}
              </h1>
              <p className="text-xs/4 text-content-muted-foreground">{modeLabel}</p>
            </div>
            <button
              type="button"
              aria-label={`Edit title for ${session.title}`}
              disabled={Boolean(unavailability)}
              className="shrink-0 rounded-sm p-1.5 disabled:cursor-not-allowed disabled:opacity-50 text-session-pin opacity-0 transition-opacity motion-reduce:transition-none hover:bg-session-interaction focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring group-hover/title:opacity-100 group-focus-within/title:opacity-100"
              onClick={(event) => {
                event.stopPropagation()
                onStartTitleEditing()
              }}
            >
              <Pencil aria-hidden="true" className="size-4" />
            </button>
          </>
        )}
        <SessionPinButton
          sessionName={session.title}
          pinned={pinned}
          disabled={Boolean(unavailability) && !pinned}
          onToggle={onTogglePin}
          className="ml-auto shrink-0"
        />
      </header>

      <SessionMessages
        sessionId={session.id}
        isWorking={isWorking}
        isCompacting={transcriptState.snapshot?.isCompacting ?? false}
        transcript={transcriptState.snapshot}
        timelineAnnouncement={transcriptState.announcement}
        timelineError={transcriptState.error}
        onReloadTimeline={transcriptState.reload}
        onActionCard={async (card: SessionActionCard) => {
          if (card.kind === 'start-implement-session') {
            await onStartImplementSession(session.workstreamId)
            return acceptActionCard(session.id, card.id)
          }

          const result = await submitMessage({
            sessionId: session.id,
            delivery: 'action',
            text: 'Create a draft pull request for the completed work. Review the current changes, validation results, and branch status, then prepare a clear title and description for my approval.',
          })

          return result.status === 'accepted' && (await acceptActionCard(session.id, card.id))
        }}
        onDismissActionCard={(card) => dismissActionCard(session.id, card.id)}
      />
      {!composerUnavailable && transcriptState.snapshot?.queuedFollowUps && (
        <QueuedFollowUpTray
          sessionId={session.id}
          isWorking={isWorking}
          queuedFollowUps={transcriptState.snapshot.queuedFollowUps}
          queuedFollowUpsPaused={transcriptState.snapshot.queuedFollowUpsPaused ?? false}
          removeQueuedFollowUp={removeQueuedFollowUp}
          resumeQueuedFollowUps={resumeQueuedFollowUps}
        />
      )}
      {composerUnavailable ? (
        <div className="composer-tray relative z-10 shrink-0 px-4 pt-3 pb-4">
          <div className="composer-surface flex min-h-13 items-center justify-center gap-2 rounded-xl border border-dashed border-composer-border bg-composer-background px-4 text-center text-sm/5 text-composer-muted-foreground">
            {unavailability ? (
              <>
                <TriangleAlert aria-hidden="true" className="size-4 shrink-0" />
                {unavailability === 'history-and-checkout'
                  ? 'This Session’s history file and Repository checkout are unavailable.'
                  : unavailability === 'history'
                    ? 'This Session’s history file is unavailable.'
                    : 'This Session’s Repository checkout is unavailable.'}
              </>
            ) : (
              <>
                <LockKeyhole aria-hidden="true" className="size-4 shrink-0" />
                Restore this Workstream to continue.
              </>
            )}
          </div>
        </div>
      ) : (
        <Composer
          session={session}
          draft={draft}
          focusRequest={composerFocusRequest}
          isWorking={isWorking}
          isCompacting={transcriptState.snapshot?.isCompacting ?? false}
          contextUsage={transcriptState.snapshot?.contextUsage}
          onActivate={onActivate}
          onDraftChange={onDraftChange}
          submitMessage={submitMessage}
          stopRun={stopRun}
          sessionConfiguration={sessionConfiguration}
          sessionSkills={sessionSkills}
        />
      )}
    </section>
  )
}
