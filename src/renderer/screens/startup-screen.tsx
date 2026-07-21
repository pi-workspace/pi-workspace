import { ScrollText, Workflow } from 'lucide-react'
import type { Ref } from 'react'
import { Button } from '@/components/ui-kit/button'
import type { SessionId } from '@/src/domain/session'
import type { OwnedSession } from '@/src/domain/workstream'
import { sessionUnavailabilityContext } from '@/src/renderer/session-availability'

type StartupScreenProperties = {
  recentSessions: readonly OwnedSession[]
  onActivateSession: (sessionId: SessionId) => void
  onCreateWorkstream: () => void
  onCreateQuickSession: () => void
  onOpenChangelog: () => void
  changelogButtonRef?: Ref<HTMLElement>
}

export function StartupScreen({
  recentSessions,
  onActivateSession,
  onCreateWorkstream,
  onCreateQuickSession,
  onOpenChangelog,
  changelogButtonRef,
}: StartupScreenProperties) {
  return (
    <div className="relative isolate flex min-h-full flex-1 flex-col overflow-hidden px-6 py-12 sm:px-10 lg:px-16">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-1/2 -right-1/4 size-[min(72rem,110vw)] rounded-full bg-session-interaction blur-[120px]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-1/2 -left-1/4 size-[min(48rem,75vw)] rounded-full bg-session-header-active-background blur-[100px]"
      />

      <div className="relative flex flex-1 items-center">
        <div className="mx-auto grid w-full max-w-5xl gap-14 lg:grid-cols-[minmax(0,1.15fr)_minmax(17rem,0.85fr)] lg:gap-24">
          <section className="flex flex-col items-start">
            <p className="text-sm/6 font-medium text-content-muted-foreground">Pi Workspace</p>
            <h1 className="mt-3 max-w-xl text-3xl/10 font-semibold tracking-tight text-content-foreground sm:text-4xl/12">
              Move one durable goal forward.
            </h1>
            <p className="mt-4 max-w-lg text-base/7 text-content-muted-foreground">
              Start a Workstream to keep its goal, Sessions, and Repository context together across restarts.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <Button color="accent" onClick={onCreateWorkstream}>
                <Workflow aria-hidden="true" data-slot="icon" />
                Create Workstream
              </Button>
              <Button outline onClick={onCreateQuickSession}>
                Quick Session
              </Button>
            </div>
          </section>

          {recentSessions.length > 0 && (
            <section
              aria-labelledby="recent-sessions-heading"
              className="min-w-0 border-t border-content-border pt-6 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-10"
            >
              <h2 id="recent-sessions-heading" className="text-sm/6 font-medium text-content-foreground">
                Recent sessions
              </h2>
              <ul className="mt-3 flex flex-col gap-0.5">
                {recentSessions.map((session) => {
                  const unavailableContext = sessionUnavailabilityContext(session)

                  return (
                    <li key={session.id} className="min-w-0">
                      <button
                        type="button"
                        disabled={Boolean(unavailableContext)}
                        className="flex w-full cursor-default items-center rounded-sm px-2 py-2 text-left text-sm/5 font-normal text-content-foreground hover:bg-session-interaction focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-50"
                        title={session.title}
                        onClick={() => onActivateSession(session.id)}
                      >
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate">{session.title}</span>
                          {unavailableContext && (
                            <span className="truncate text-xs/4 text-content-muted-foreground">
                              {unavailableContext}
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>
          )}
        </div>
      </div>

      <div className="relative flex justify-center">
        <div className="relative inline-flex">
          <Button ref={changelogButtonRef} plain onClick={onOpenChangelog} aria-label="Changelog">
            <ScrollText aria-hidden="true" data-slot="icon" />
            Changelog
          </Button>
        </div>
      </div>
    </div>
  )
}
