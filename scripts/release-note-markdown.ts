import { bundledReleaseNotes, type ReleaseNote } from '../src/release-notes'

const changeGroups: readonly [keyof ReleaseNote['changes'], string][] = [
  ['new', 'New'],
  ['improved', 'Improved'],
  ['fixed', 'Fixed'],
]

export function formatReleaseNoteAsMarkdown(releaseNote: ReleaseNote): string {
  const sections = changeGroups.flatMap(([key, heading]) => {
    const changes = releaseNote.changes[key]

    return changes.length === 0 ? [] : [`## ${heading}\n\n${changes.map((change) => `- ${change}`).join('\n')}`]
  })

  return `${releaseNote.summary}\n\n${sections.join('\n\n')}\n`
}

if (import.meta.main) {
  const latestReleaseNote = bundledReleaseNotes[0]

  if (!latestReleaseNote) {
    throw new Error('A bundled Release Note is required before publishing a release.')
  }

  process.stdout.write(formatReleaseNoteAsMarkdown(latestReleaseNote))
}
