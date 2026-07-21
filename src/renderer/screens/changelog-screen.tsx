import { ArrowLeft } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { Badge } from '@/components/ui-kit/badge'
import { Button } from '@/components/ui-kit/button'
import type { ReleaseNote } from '@/src/release-notes'

type ChangelogScreenProperties = Readonly<{
  releaseNotes: readonly ReleaseNote[]
  onBack: () => void
}>

const releaseDateFormatter = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
  year: 'numeric',
})

const changeGroups = [
  { key: 'new', label: 'New' },
  { key: 'improved', label: 'Improved' },
  { key: 'fixed', label: 'Fixed' },
] as const

export function ChangelogScreen({ releaseNotes, onBack }: ChangelogScreenProperties) {
  const headingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  return (
    <div className="flex h-full min-h-0 flex-col bg-content-background text-content-foreground">
      <header className="flex shrink-0 items-center gap-2 border-b border-content-border px-3 py-2">
        <Button plain onClick={onBack} className="shrink-0">
          <ArrowLeft aria-hidden="true" data-slot="icon" />
          Back
        </Button>
        <h1 ref={headingRef} tabIndex={-1} className="truncate text-sm/6 font-semibold outline-none">
          Changelog
        </h1>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-6 py-8 sm:px-8 sm:py-10">
          <p className="text-sm/6 text-content-muted-foreground">What’s new, improved, and fixed in Pi Workspace.</p>

          <div className="mt-8">
            {releaseNotes.map((releaseNote, index) => (
              <article
                key={releaseNote.version}
                className="border-t border-content-border py-10 first:border-t-0 first:pt-0"
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <h2 className="text-2xl/8 font-semibold tracking-tight">Version {releaseNote.version}</h2>
                  {index === 0 && <Badge color="green">Latest</Badge>}
                </div>
                <time dateTime={releaseNote.releaseDate} className="mt-2 block text-sm/6 text-content-muted-foreground">
                  {releaseDateFormatter.format(new Date(`${releaseNote.releaseDate}T00:00:00.000Z`))}
                </time>
                <p className="mt-4 text-base/7 text-content-muted-foreground">{releaseNote.summary}</p>

                <div className="mt-7 space-y-6">
                  {changeGroups.map(({ key, label }) => {
                    const changes = releaseNote.changes[key]

                    if (changes.length === 0) {
                      return null
                    }

                    return (
                      <section key={key} aria-labelledby={`${key}-${releaseNote.version}`}>
                        <h3 id={`${key}-${releaseNote.version}`} className="text-sm/6 font-semibold">
                          {label}
                        </h3>
                        <ul className="mt-2 list-disc space-y-2 pl-5 text-sm/6 text-content-muted-foreground marker:text-changelog-list-marker">
                          {changes.map((change) => (
                            <li key={change}>{change}</li>
                          ))}
                        </ul>
                      </section>
                    )
                  })}
                </div>
              </article>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
