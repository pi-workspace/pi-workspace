import { FoldHorizontal, GitFork, LoaderCircle } from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui-kit/button'
import type { SessionId } from '@/src/domain/session'
import type { SessionActionCard } from '@/src/session-action-cards'
import type { SessionCodeReview, SessionCodeReviewComment } from '@/src/session-code-review'
import { projectSessionSkillSelections, type SessionSkillMention } from '@/src/session-skills'
import { AgentActivityCard } from '@/src/renderer/components/agent-activity-card'
import { DiffView } from '@/src/renderer/components/diff-view'
import { ReferenceMentionText } from '@/src/renderer/components/reference-mention-text'
import { SkillMentionText } from '@/src/renderer/components/skill-mention-text'
import type { AgentActivity, ContextCompaction } from '@/src/session-timeline'
import type { SessionTranscriptMessage, SessionTranscriptSnapshot } from '@/src/session-transcript'

type SessionMessagesProperties = Readonly<{
  sessionId: SessionId
  isWorking: boolean
  isCompacting?: boolean
  transcript?: SessionTranscriptSnapshot
  timelineAnnouncement?: string
  timelineError?: string
  onReloadTimeline?: () => void
  onForkFromMessage?: (position: number) => void
  onActionCard?: (card: SessionActionCard) => Promise<boolean>
  onDismissActionCard?: (card: SessionActionCard) => Promise<boolean>
  onOpenCurrentDiff?: (repositoryId: string | undefined, path: string) => void
}>

type TranscriptEntry =
  | Readonly<{ type: 'message'; key: string; message: SessionTranscriptMessage; userPosition?: number }>
  | Readonly<{ type: 'activity'; key: string; activity: AgentActivity }>
  | Readonly<{ type: 'compaction'; key: string; compaction: ContextCompaction }>

const bottomThreshold = 24
const MarkdownMessage = lazy(async () =>
  import('@/src/renderer/components/markdown-message').then(({ MarkdownMessage }) => ({ default: MarkdownMessage }))
)

export function SessionMessages({
  sessionId,
  isWorking,
  isCompacting,
  transcript: canonicalTranscript,
  timelineAnnouncement,
  timelineError,
  onReloadTimeline,
  onForkFromMessage,
  onActionCard = async () => false,
  onDismissActionCard = async () => false,
  onOpenCurrentDiff = () => {},
}: SessionMessagesProperties) {
  const isLoading = !canonicalTranscript
  const loadError = Boolean(timelineError)
  const reload = onReloadTimeline ?? (() => {})
  const revision = canonicalTranscript?.revision ?? 0
  const transcript = useMemo<readonly TranscriptEntry[]>(() => {
    let userPosition = 0

    return (
      canonicalTranscript?.entries.map((entry) => {
        if (entry.type === 'activity') {
          return { type: 'activity' as const, key: `activity-${entry.activity.id}`, activity: entry.activity }
        }
        if (entry.type === 'compaction') {
          return { type: 'compaction' as const, key: `compaction-${entry.compaction.id}`, compaction: entry.compaction }
        }

        const position = entry.message.role === 'user' ? ++userPosition : undefined
        return {
          type: 'message' as const,
          key: `message-${entry.message.id}`,
          message: entry.message,
          userPosition: position,
        }
      }) ?? []
    )
  }, [canonicalTranscript])
  const runFailureReason = canonicalTranscript?.runFailureReason
  const [pendingExternalUrl, setPendingExternalUrl] = useState<string>()
  const [externalLinkError, setExternalLinkError] = useState(false)
  const [externalLinkPending, setExternalLinkPending] = useState(false)
  const externalLinkPendingRef = useRef(false)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const messageListRef = useRef<HTMLDivElement>(null)
  const {
    hasUnseenContent,
    isInitialPositioned,
    jumpToLatest,
    onKeyDown,
    onPointerDown,
    onScroll,
    onTouchStart,
    onWheel,
  } = useTranscriptScroll({
    scrollContainerRef,
    messageListRef,
    isLoading,
    contentVersion: `${revision}:${isWorking ? 'working' : 'idle'}:${isCompacting ? 'compacting' : 'ready'}:${runFailureReason ?? 'ready'}`,
  })

  const requestExternalLink = useCallback((url: string) => {
    setExternalLinkError(false)
    setPendingExternalUrl(url)
  }, [])

  return (
    <div className="session-message-interface relative min-h-0 flex-1">
      <div
        ref={scrollContainerRef}
        className={`h-full min-h-0 overflow-y-auto${isInitialPositioned ? '' : ' invisible'}`}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onScroll={onScroll}
        onTouchStart={onTouchStart}
        onWheel={onWheel}
      >
        <div ref={messageListRef} className="session-messages-reading-column mx-auto w-full max-w-[760px] space-y-6">
          {loadError ? (
            <ResourceFailure
              message="Could not load this Session’s messages."
              action="Reload messages"
              onRetry={reload}
            />
          ) : null}
          {timelineError && onReloadTimeline ? (
            <ResourceFailure message={timelineError} action="Reload timeline" onRetry={onReloadTimeline} />
          ) : null}
          {!isLoading &&
            transcript.map((entry) =>
              entry.type === 'message' ? (
                <SessionMessageRow
                  key={entry.key}
                  message={entry.message}
                  isWorking={isWorking}
                  userPosition={entry.userPosition}
                  onForkFromMessage={onForkFromMessage}
                  onOpenExternalLink={requestExternalLink}
                />
              ) : entry.type === 'compaction' ? (
                <SessionCompactionSummary
                  key={entry.key}
                  compaction={entry.compaction}
                  onOpenExternalLink={requestExternalLink}
                />
              ) : (
                <AgentActivityCard
                  key={entry.key}
                  activity={entry.activity}
                  loadDetails={() => window.piWorkspace.transcript.loadActivityDetails(sessionId, entry.activity.id)}
                  onOpenCurrentDiff={onOpenCurrentDiff}
                />
              )
            )}
          {!isLoading &&
            canonicalTranscript?.actionCards
              ?.filter((card) => card.status === 'available')
              .map((card) => (
                <SessionActionCardView
                  key={card.id}
                  card={card}
                  onAction={() => onActionCard(card)}
                  onDismiss={() => onDismissActionCard(card)}
                />
              ))}
          {isCompacting && <SessionActivityIndicator label="Pi is compacting this Session…" />}
          {!isLoading && runFailureReason ? (
            <SessionRunFailure reason={runFailureReason} />
          ) : !isLoading && isWorking ? (
            <SessionActivityIndicator />
          ) : null}
        </div>
      </div>
      {hasUnseenContent ? (
        <button
          type="button"
          className="absolute right-4 bottom-3 rounded-lg bg-composer-action-background px-3 py-1.5 text-xs font-medium text-composer-action-foreground shadow-sm outline-none transition-colors motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-content-background"
          onClick={jumpToLatest}
        >
          Jump to latest
        </button>
      ) : null}
      {pendingExternalUrl ? (
        <ExternalLinkConfirmation
          url={pendingExternalUrl}
          error={externalLinkError}
          pending={externalLinkPending}
          onCancel={() => {
            if (externalLinkPendingRef.current) return

            setPendingExternalUrl(undefined)
            setExternalLinkError(false)
          }}
          onConfirm={async () => {
            if (externalLinkPendingRef.current) return

            externalLinkPendingRef.current = true
            setExternalLinkPending(true)

            try {
              await window.piWorkspace.transcript.openExternalLink(pendingExternalUrl)
              setPendingExternalUrl(undefined)
              setExternalLinkError(false)
            } catch {
              setExternalLinkError(true)
            } finally {
              externalLinkPendingRef.current = false
              setExternalLinkPending(false)
            }
          }}
        />
      ) : null}
      <p aria-live="polite" className="sr-only">
        {timelineAnnouncement}
      </p>
    </div>
  )
}

function SessionActionCardView({
  card,
  onAction,
  onDismiss,
}: Readonly<{
  card: SessionActionCard
  onAction: () => Promise<boolean>
  onDismiss: () => Promise<boolean>
}>) {
  const [actionState, setActionState] = useState<'idle' | 'working' | 'complete' | 'failed'>('idle')
  const [dismissState, setDismissState] = useState<'idle' | 'working' | 'dismissed' | 'failed'>('idle')
  const disabled = actionState === 'working' || actionState === 'complete' || dismissState === 'working'
  const runAction = async () => {
    setActionState('working')

    try {
      setActionState((await onAction()) ? 'complete' : 'failed')
    } catch {
      setActionState('failed')
    }
  }
  const dismiss = async () => {
    setDismissState('working')

    try {
      setDismissState((await onDismiss()) ? 'dismissed' : 'failed')
    } catch {
      setDismissState('failed')
    }
  }

  if (dismissState === 'dismissed') return null

  return (
    <aside
      className="rounded-xl border border-activity-border bg-activity-background px-4 py-3"
      aria-label="Suggested action"
    >
      <p className="text-xs/5 font-medium text-content-muted-foreground">Suggested by Pi</p>
      <h2 className="mt-1 text-sm/5 font-medium text-content-foreground">{card.title}</h2>
      <p className="mt-1 text-sm/5 text-content-muted-foreground">{card.description}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {card.kind === 'start-implement-session' ? (
          <Button disabled={disabled} onClick={() => void runAction()}>
            {actionState === 'working'
              ? 'Starting…'
              : actionState === 'complete'
                ? 'Implement Session started'
                : 'Start Implement Session'}
          </Button>
        ) : (
          <Button disabled={disabled} onClick={() => void runAction()}>
            {actionState === 'working'
              ? 'Preparing pull request…'
              : actionState === 'complete'
                ? 'Pull request request sent'
                : 'Prepare draft pull request'}
          </Button>
        )}
        <Button outline disabled={disabled} onClick={() => void dismiss()}>
          {dismissState === 'working' ? 'Dismissing…' : 'Not now'}
        </Button>
      </div>
      {actionState === 'failed' ? (
        <p className="mt-2 text-sm/5 text-activity-failed">
          {card.kind === 'start-implement-session' ? 'Could not start this action.' : 'Could not start this request.'}
        </p>
      ) : null}
      {dismissState === 'failed' ? (
        <p className="mt-2 text-sm/5 text-activity-failed">Could not dismiss this suggestion.</p>
      ) : null}
    </aside>
  )
}

function useTranscriptScroll({
  scrollContainerRef,
  messageListRef,
  isLoading,
  contentVersion,
}: Readonly<{
  scrollContainerRef: React.RefObject<HTMLDivElement | null>
  messageListRef: React.RefObject<HTMLDivElement | null>
  isLoading: boolean
  contentVersion: string
}>) {
  const followingLatest = useRef(true)
  const hasPendingManualScroll = useRef(false)
  const initialPositioned = useRef(false)
  const animationFrame = useRef<number | undefined>(undefined)
  const [hasUnseenContent, setHasUnseenContent] = useState(false)
  const [isInitialPositioned, setIsInitialPositioned] = useState(false)

  const writeBottomPosition = useCallback((behavior: ScrollBehavior = 'auto') => {
    const container = scrollContainerRef.current

    if (!container) {
      return
    }

    if (typeof container.scrollTo === 'function') {
      container.scrollTo({ top: container.scrollHeight, behavior })
    } else {
      container.scrollTop = container.scrollHeight
    }
  }, [])

  const scheduleBottomPosition = useCallback(() => {
    if (animationFrame.current !== undefined) {
      return
    }

    animationFrame.current = window.requestAnimationFrame(() => {
      animationFrame.current = undefined

      if (followingLatest.current) {
        writeBottomPosition()
      }
    })
  }, [writeBottomPosition])

  const revealAfterInitialPosition = useCallback(() => {
    if (animationFrame.current !== undefined) {
      return
    }

    animationFrame.current = window.requestAnimationFrame(() => {
      animationFrame.current = undefined

      if (followingLatest.current) {
        writeBottomPosition()
      }

      setIsInitialPositioned(true)
    })
  }, [writeBottomPosition])

  useEffect(() => {
    const messageList = messageListRef.current

    if (!messageList || typeof ResizeObserver === 'undefined') {
      return
    }

    const observer = new ResizeObserver(() => {
      if (followingLatest.current && initialPositioned.current) {
        scheduleBottomPosition()
      }
    })
    observer.observe(messageList)

    return () => observer.disconnect()
  }, [messageListRef, scheduleBottomPosition])

  useLayoutEffect(() => {
    if (isLoading) {
      initialPositioned.current = false
      setIsInitialPositioned(false)
      return
    }

    if (!initialPositioned.current) {
      initialPositioned.current = true
      followingLatest.current = true
      writeBottomPosition()
      revealAfterInitialPosition()
      return
    }

    if (followingLatest.current) {
      scheduleBottomPosition()
    } else {
      setHasUnseenContent(true)
    }
  }, [contentVersion, isLoading, revealAfterInitialPosition, scheduleBottomPosition, writeBottomPosition])

  useEffect(
    () => () => {
      if (animationFrame.current !== undefined) {
        window.cancelAnimationFrame(animationFrame.current)
      }
    },
    []
  )

  return {
    hasUnseenContent,
    isInitialPositioned,
    jumpToLatest() {
      followingLatest.current = true
      setHasUnseenContent(false)

      const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

      writeBottomPosition(reducedMotion ? 'auto' : 'smooth')
    },
    onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
      if (!['ArrowDown', 'ArrowUp', 'End', 'Home', 'PageDown', 'PageUp', ' '].includes(event.key)) {
        return
      }

      hasPendingManualScroll.current = true
    },
    onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
      if (event.target === event.currentTarget) {
        hasPendingManualScroll.current = true
      }
    },
    onScroll() {
      const container = scrollContainerRef.current

      if (!container) {
        return
      }

      const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight <= bottomThreshold

      if (atBottom) {
        followingLatest.current = true
        setHasUnseenContent(false)
      } else if (!hasPendingManualScroll.current && followingLatest.current) {
        scheduleBottomPosition()
      } else {
        followingLatest.current = false
      }

      hasPendingManualScroll.current = false
    },
    onTouchStart() {
      hasPendingManualScroll.current = true
    },
    onWheel() {
      hasPendingManualScroll.current = true
    },
  }
}

function SessionMessageRow({
  message,
  isWorking,
  userPosition,
  onForkFromMessage,
  onOpenExternalLink,
}: Readonly<{
  message: SessionTranscriptMessage
  isWorking: boolean
  userPosition?: number
  onForkFromMessage?: (position: number) => void
  onOpenExternalLink: (url: string) => void
}>) {
  if (message.role === 'user') {
    if (message.codeReview) return <CodeReviewMessageCard review={message.codeReview} skills={message.skills ?? []} />

    const steering = message.delivery === 'steer'

    return (
      <article
        className={`group/message relative ml-auto w-fit max-w-[80%] rounded-xl border px-3 py-2 text-sm/6 ${
          steering
            ? `border-content-border bg-content-subtle-background text-content-foreground opacity-80${
                isWorking ? ' motion-safe:animate-pulse' : ''
              }`
            : 'border-session-message-person-border bg-session-message-person-background text-session-message-person-foreground'
        }`}
      >
        {steering && <p className="mb-1 text-xs/4 font-medium text-content-muted-foreground">Steering</p>}
        <p className="whitespace-pre-wrap break-words">
          {message.files?.length ? (
            <ReferenceMentionText text={message.text} skills={message.skills ?? []} files={message.files} />
          ) : (
            <SkillMentionText text={message.text} skills={message.skills ?? []} />
          )}
        </p>
        {onForkFromMessage && userPosition !== undefined && message.state === 'complete' && !isWorking && (
          <button
            type="button"
            aria-label={`Fork from “${message.text.slice(0, 40) || 'this message'}”`}
            title="Fork from here"
            className="absolute top-1/2 right-full z-10 mr-2 -translate-y-1/2 rounded-sm p-1.5 text-content-muted-foreground opacity-0 transition-opacity motion-reduce:transition-none hover:bg-session-interaction hover:text-content-foreground focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring group-hover/message:opacity-100 group-focus-within/message:opacity-100"
            onClick={() => onForkFromMessage(userPosition)}
          >
            <GitFork aria-hidden="true" className="size-3.5" />
          </button>
        )}
      </article>
    )
  }

  return (
    <article className="min-w-0 text-sm/6 text-session-message-pi-foreground">
      <p className="mb-1 text-xs/5 font-medium text-session-message-label-foreground">Pi</p>
      <Suspense fallback={<p className="text-content-muted-foreground">Loading message…</p>}>
        <MarkdownMessage
          source={message.text}
          streaming={message.state === 'streaming'}
          onOpenExternalLink={onOpenExternalLink}
        />
      </Suspense>
    </article>
  )
}

function CodeReviewMessageCard({
  review,
  skills,
}: Readonly<{ review: SessionCodeReview; skills: readonly SessionSkillMention[] }>) {
  const files = new Map<string, { repositoryName: string; path: string; comments: SessionCodeReviewComment[] }>()

  review.comments.forEach((comment) => {
    const reference = comment.reference
    const key = `${reference.repositoryId}\0${reference.path}`
    const file = files.get(key) ?? {
      repositoryName: reference.repositoryName,
      path: reference.path,
      comments: [],
    }
    file.comments.push(comment)
    files.set(key, file)
  })

  return (
    <article className="ml-auto w-full max-w-[90%] overflow-hidden rounded-xl border border-session-message-person-border bg-session-message-person-background text-session-message-person-foreground">
      <header className="border-b border-session-message-person-border px-4 py-3">
        <p className="text-xs/4 font-medium text-content-muted-foreground">
          {review.kind === 'review' ? 'Finished review' : 'Referenced follow-up'}
        </p>
        <p className="mt-0.5 text-sm/5 font-medium">
          {review.comments.length} {review.comments.length === 1 ? 'comment' : 'comments'} across {files.size}{' '}
          {files.size === 1 ? 'file' : 'files'}
        </p>
      </header>
      <div className="divide-y divide-session-message-person-border">
        {[...files.values()].map((file) => (
          <details key={`${file.repositoryName}-${file.path}`} open={review.kind === 'follow-up'}>
            <summary className="cursor-pointer list-none px-4 py-2.5 text-xs/5 font-medium outline-none hover:bg-session-interaction focus-visible:ring-2 focus-visible:ring-focus-ring">
              <span className="block truncate">{file.path}</span>
              <span className="block truncate font-normal text-content-muted-foreground">
                {file.repositoryName} · {file.comments.length} {file.comments.length === 1 ? 'comment' : 'comments'}
              </span>
            </summary>
            <div className="space-y-3 border-t border-session-message-person-border px-3 py-3">
              {file.comments.map((comment) => (
                <div className="space-y-2" key={comment.id}>
                  <p className="text-[10px]/4 font-medium uppercase tracking-wide text-content-muted-foreground">
                    {codeReferenceRange(comment)}
                  </p>
                  <p className="whitespace-pre-wrap break-words text-sm/6">
                    <ReviewCommentText comment={comment} skills={skills} />
                  </p>
                  {comment.reference.truncated && (
                    <p className="text-[10px]/4 text-content-muted-foreground">Referenced diff was truncated.</p>
                  )}
                  <details>
                    <summary className="w-fit cursor-pointer rounded text-xs/5 font-medium text-content-muted-foreground outline-none hover:text-content-foreground focus-visible:ring-2 focus-visible:ring-focus-ring">
                      View referenced diff
                    </summary>
                    <div className="mt-2">
                      <DiffView content={comment.reference.patch} label={`Referenced diff for ${file.path}`} />
                    </div>
                  </details>
                </div>
              ))}
            </div>
          </details>
        ))}
      </div>
    </article>
  )
}

function ReviewCommentText({
  comment,
  skills,
}: Readonly<{ comment: SessionCodeReviewComment; skills: readonly SessionSkillMention[] }>) {
  const projected = projectSessionSkillSelections(comment.text)
  const mentions = projected.selections.map(({ name, offset }) => ({
    offset,
    skill: skills.find((mention) => mention.skill.name === name)?.skill ?? {
      name,
      availability: 'unavailable' as const,
    },
  }))

  return <SkillMentionText text={projected.text} skills={mentions} />
}

function codeReferenceRange(comment: SessionCodeReviewComment): string {
  const reference = comment.reference
  if (reference.newLines > 0) {
    const end = reference.newStart + reference.newLines - 1
    return `Lines +${reference.newStart}${end === reference.newStart ? '' : `–${end}`}`
  }

  const end = reference.oldStart + Math.max(1, reference.oldLines) - 1
  return `Lines -${reference.oldStart}${end === reference.oldStart ? '' : `–${end}`}`
}

function SessionCompactionSummary({
  compaction,
  onOpenExternalLink,
}: Readonly<{ compaction: ContextCompaction; onOpenExternalLink: (url: string) => void }>) {
  return (
    <details className="group rounded-xl border border-content-border bg-content-subtle-background px-4 py-3 text-content-foreground">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-xs/5 font-medium text-session-message-status-foreground outline-none focus-visible:ring-2 focus-visible:ring-focus-ring">
        <FoldHorizontal aria-hidden="true" className="size-3.5 shrink-0" />
        <span>Context compacted</span>
        <span className="ml-auto font-normal text-content-muted-foreground group-open:hidden">View summary</span>
        <span className="ml-auto hidden font-normal text-content-muted-foreground group-open:inline">Hide summary</span>
      </summary>
      <div className="mt-3 border-t border-content-border pt-3 text-sm/6">
        <Suspense fallback={<p className="text-content-muted-foreground">Loading summary…</p>}>
          <MarkdownMessage source={compaction.summary} streaming={false} onOpenExternalLink={onOpenExternalLink} />
        </Suspense>
      </div>
    </details>
  )
}

function SessionActivityIndicator({ label = 'Pi is working' }: Readonly<{ label?: string }>) {
  return (
    <div className="flex items-center gap-2 text-xs/5 text-session-message-status-foreground" role="status">
      <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin motion-reduce:animate-none" />
      <span>{label}</span>
    </div>
  )
}

function SessionRunFailure({ reason }: Readonly<{ reason: 'failed' | 'cancelled' }>) {
  return (
    <p className="text-xs/5 text-session-message-error-foreground" role="status">
      {reason === 'cancelled' ? 'You stopped this turn.' : 'Pi couldn’t complete its response.'}
    </p>
  )
}

function ResourceFailure({
  message,
  action,
  onRetry,
}: Readonly<{ message: string; action: string; onRetry: () => void }>) {
  return (
    <div
      className="rounded-lg border border-content-border p-3 text-sm/6 text-session-message-error-foreground"
      role="alert"
    >
      <p>{message}</p>
      <button
        type="button"
        className="mt-2 rounded-md font-medium text-content-foreground outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        onClick={onRetry}
      >
        {action}
      </button>
    </div>
  )
}

function ExternalLinkConfirmation({
  url,
  error,
  pending,
  onCancel,
  onConfirm,
}: Readonly<{
  url: string
  error: boolean
  pending: boolean
  onCancel: () => void
  onConfirm: () => void | Promise<void>
}>) {
  return (
    <div
      aria-labelledby="external-link-confirmation-title"
      className="absolute right-4 bottom-3 z-10 w-[min(24rem,calc(100%-2rem))] rounded-xl border border-content-border bg-content-background p-3 shadow-lg"
      role="dialog"
    >
      <p id="external-link-confirmation-title" className="text-sm/6 font-medium text-content-foreground">
        Open external link?
      </p>
      <p className="mt-1 break-all text-xs/5 text-session-message-status-foreground">{url}</p>
      {error ? (
        <p className="mt-2 text-xs/5 text-session-message-error-foreground" role="alert">
          Could not open the link. Check your system settings and try again.
        </p>
      ) : null}
      <div className="mt-3 flex justify-end gap-2">
        <Button
          plain
          className="cursor-pointer !rounded-md !px-2.5 !py-1.5 !text-xs/5 !font-normal !text-content-foreground hover:bg-session-interaction"
          disabled={pending}
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button
          plain
          className="cursor-pointer !rounded-md !border-transparent !bg-composer-action-background !px-2.5 !py-1.5 !text-xs/5 !text-composer-action-foreground data-hover:!bg-composer-action-background hover:opacity-90"
          disabled={pending}
          onClick={onConfirm}
        >
          {error ? 'Try opening again' : 'Open link'}
        </Button>
      </div>
    </div>
  )
}
