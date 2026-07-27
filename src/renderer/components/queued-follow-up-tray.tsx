import { ListRestart, X } from 'lucide-react'
import { useCallback, useState } from 'react'
import type { ComposerBridge } from '@/src/composer'
import type { SessionId } from '@/src/domain/session'
import type { QueuedFollowUp } from '@/src/queued-follow-up'
import { SkillMentionText } from '@/src/renderer/components/skill-mention-text'
import { projectSessionSkillSelections } from '@/src/session-skills'

const maximumVisibleFollowUps = 3
const collapsedFollowUpOffset = 8
const expandedFollowUpOffset = 72
const followUpCardHeight = 64

type QueuedFollowUpTrayProperties = Readonly<{
  sessionId: SessionId
  isWorking: boolean
  queuedFollowUps: readonly QueuedFollowUp[]
  queuedFollowUpsPaused?: boolean
  removeQueuedFollowUp?: NonNullable<ComposerBridge['removeQueuedFollowUp']>
  resumeQueuedFollowUps?: NonNullable<ComposerBridge['resumeQueuedFollowUps']>
}>

function QueuedFollowUpContent({ followUp, next }: Readonly<{ followUp: QueuedFollowUp; next: boolean }>) {
  const reviewComment = followUp.codeReview?.comments[0]
  const source = reviewComment?.text ?? followUp.text
  const projected = projectSessionSkillSelections(source)
  const skills = reviewComment
    ? projected.selections.map(({ name, offset }) => ({
        offset,
        skill: followUp.skills?.find((mention) => mention.skill.name === name)?.skill ?? {
          name,
          availability: 'unavailable' as const,
        },
      }))
    : (followUp.skills ??
      projected.selections.map(({ name, offset }) => ({
        offset,
        skill: { name, availability: 'unavailable' as const },
      })))

  return (
    <>
      <span className="block text-xs/4 font-medium text-content-muted-foreground">
        {next ? 'Next follow-up' : 'Follow-up'}
        {reviewComment ? ` · ${reviewComment.reference.path}` : ''}
      </span>
      <span className="mt-0.5 line-clamp-2 block whitespace-pre-wrap break-words">
        <SkillMentionText text={projected.text} skills={skills} />
      </span>
    </>
  )
}

export function QueuedFollowUpTray({
  sessionId,
  isWorking,
  queuedFollowUps,
  queuedFollowUpsPaused = false,
  removeQueuedFollowUp: removeQueuedFollowUpMessage,
  resumeQueuedFollowUps: resumeQueuedFollowUpMessages,
}: QueuedFollowUpTrayProperties) {
  const [expanded, setExpanded] = useState(false)
  const [actionPending, setActionPending] = useState(false)
  const visibleFollowUps = queuedFollowUps.slice(0, maximumVisibleFollowUps)

  const removeQueuedFollowUp = useCallback(
    async (followUpId: string) => {
      if (!removeQueuedFollowUpMessage || actionPending) return

      setActionPending(true)

      try {
        await removeQueuedFollowUpMessage(sessionId, followUpId)
      } finally {
        setActionPending(false)
      }
    },
    [actionPending, removeQueuedFollowUpMessage, sessionId]
  )

  const resumeQueuedFollowUps = useCallback(async () => {
    if (!resumeQueuedFollowUpMessages || actionPending) return

    setActionPending(true)

    try {
      await resumeQueuedFollowUpMessages(sessionId)
    } finally {
      setActionPending(false)
    }
  }, [actionPending, resumeQueuedFollowUpMessages, sessionId])

  if (queuedFollowUps.length === 0) return null

  return (
    <div
      className="relative z-20 h-19 shrink-0 px-3 pb-3"
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setExpanded(false)
      }}
      onFocusCapture={() => setExpanded(true)}
      onKeyDown={(event) => {
        if (event.key === 'Escape') setExpanded(false)
      }}
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
    >
      <ol
        className="absolute right-3 bottom-3 left-3"
        style={{
          height: `${followUpCardHeight + (expanded ? (visibleFollowUps.length - 1) * expandedFollowUpOffset : 0)}px`,
        }}
      >
        {visibleFollowUps.map((followUp, index) => (
          <li
            key={followUp.id}
            className={`absolute inset-x-0 bottom-0 flex min-h-13 items-center gap-2 rounded-xl border border-content-border bg-content-background px-3 py-2 text-sm/5 text-content-foreground shadow-sm transition-transform duration-150 ease-out will-change-transform motion-reduce:transition-none ${
              !expanded && index > 0 ? 'pointer-events-none' : ''
            }`}
            style={{
              transform: `translateY(-${index * (expanded ? expandedFollowUpOffset : collapsedFollowUpOffset)}px)`,
              zIndex: visibleFollowUps.length - index,
            }}
          >
            {index === 0 ? (
              <button
                type="button"
                aria-expanded={expanded}
                className="min-w-0 flex-1 rounded-sm text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                onClick={() => setExpanded((current) => !current)}
              >
                <QueuedFollowUpContent followUp={followUp} next />
              </button>
            ) : (
              <div className="min-w-0 flex-1">
                <QueuedFollowUpContent followUp={followUp} next={false} />
              </div>
            )}
            <div className="flex shrink-0 items-center gap-1">
              {index === 0 && queuedFollowUpsPaused && !isWorking && (
                <button
                  type="button"
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-xs/4 font-medium text-content-foreground hover:bg-session-interaction focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={!resumeQueuedFollowUpMessages || actionPending}
                  onClick={() => void resumeQueuedFollowUps()}
                >
                  <ListRestart aria-hidden="true" className="size-3.5" />
                  Resume
                </button>
              )}
              {expanded && (
                <button
                  type="button"
                  aria-label="Remove queued follow-up"
                  className="rounded-sm p-1 text-content-muted-foreground hover:bg-session-interaction hover:text-content-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={!removeQueuedFollowUpMessage || actionPending}
                  onClick={() => void removeQueuedFollowUp(followUp.id)}
                >
                  <X aria-hidden="true" className="size-4" />
                </button>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}
