import { GitFork, LoaderCircle } from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui-kit/button'
import type { SessionId } from '@/src/domain/session'
import { AgentActivityCard } from '@/src/renderer/components/agent-activity-card'
import { SkillMentionText } from '@/src/renderer/components/skill-mention-text'
import type { AgentActivity } from '@/src/session-timeline'
import type { SessionTranscriptMessage, SessionTranscriptSnapshot } from '@/src/session-transcript'

type SessionMessagesProperties = Readonly<{
  sessionId: SessionId
  isWorking: boolean
  transcript?: SessionTranscriptSnapshot
  timelineAnnouncement?: string
  timelineError?: string
  onReloadTimeline?: () => void
  onForkFromMessage?: (position: number) => void
}>

type TranscriptEntry =
  | Readonly<{ type: 'message'; key: string; message: SessionTranscriptMessage; userPosition?: number }>
  | Readonly<{ type: 'activity'; key: string; activity: AgentActivity }>

const bottomThreshold = 24
const MarkdownMessage = lazy(async () =>
  import('@/src/renderer/components/markdown-message').then(({ MarkdownMessage }) => ({ default: MarkdownMessage }))
)

export function SessionMessages({
  sessionId,
  isWorking,
  transcript: canonicalTranscript,
  timelineAnnouncement,
  timelineError,
  onReloadTimeline,
  onForkFromMessage,
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
    contentVersion: `${revision}:${isWorking ? 'working' : 'idle'}:${runFailureReason ?? 'ready'}`,
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
              ) : (
                <AgentActivityCard
                  key={entry.key}
                  activity={entry.activity}
                  loadDetails={() => window.piWorkspace.transcript.loadActivityDetails(sessionId, entry.activity.id)}
                />
              )
            )}
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
          <SkillMentionText text={message.text} skills={message.skills ?? []} />
        </p>
        {onForkFromMessage && userPosition !== undefined && message.state === 'complete' && !isWorking && (
          <button
            type="button"
            aria-label={`Fork from “${message.text.slice(0, 40) || 'this message'}”`}
            title="Fork from here"
            className="absolute -bottom-7 right-0 z-10 rounded-sm p-1.5 text-content-muted-foreground opacity-0 transition-opacity motion-reduce:transition-none hover:bg-session-interaction hover:text-content-foreground focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring group-hover/message:opacity-100 group-focus-within/message:opacity-100"
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

function SessionActivityIndicator() {
  return (
    <div className="flex items-center gap-2 text-xs/5 text-session-message-status-foreground" role="status">
      <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin motion-reduce:animate-none" />
      <span>Pi is working</span>
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
