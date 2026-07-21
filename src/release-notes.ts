export type ReleaseNoteChangeGroups = Readonly<{
  new: readonly string[]
  improved: readonly string[]
  fixed: readonly string[]
}>

export type ReleaseNote = Readonly<{
  version: string
  releaseDate: string
  summary: string
  changes: ReleaseNoteChangeGroups
}>

const semanticVersionPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*)?(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?$/

export function isSemanticVersion(version: string): boolean {
  return semanticVersionPattern.test(version)
}

export const bundledReleaseNotes: readonly ReleaseNote[] = [
  {
    version: '0.1.0-beta.1',
    releaseDate: '2026-07-21',
    summary:
      'Pi Workspace launches in public beta to keep agent work grounded. Work with Pi across Git Repositories and long-running goals—plan, implement, and pick up where you left off.',
    changes: {
      new: [
        'Organize related Git Repositories into persistent Workspaces.',
        'Create goal-based Workstreams that retain shared context across Brainstorm and Implement Sessions.',
        'Start Quick Sessions for focused work in one Repository checkout or dedicated worktree.',
        'Choose a Model and Effort in Composer using your existing Pi configuration.',
        'Pin Sessions side by side and reopen their locally stored history.',
        'Install on Debian 12 or 13 x86_64, or macOS 12 or later on Apple silicon and Intel.',
      ],
      improved: [],
      fixed: [],
    },
  },
]

function compareReleaseVersions(firstVersion: string, secondVersion: string): number {
  const parseVersion = (version: string) => {
    const versionWithoutBuild = version.split('+', 1)[0]!
    const prereleaseSeparator = versionWithoutBuild.indexOf('-')
    const core = (prereleaseSeparator === -1 ? versionWithoutBuild : versionWithoutBuild.slice(0, prereleaseSeparator))
      .split('.')
      .map(Number)
    const prerelease = prereleaseSeparator === -1 ? [] : versionWithoutBuild.slice(prereleaseSeparator + 1).split('.')

    return { core, prerelease }
  }

  const first = parseVersion(firstVersion)
  const second = parseVersion(secondVersion)

  for (let index = 0; index < 3; index += 1) {
    const difference = (first.core[index] ?? 0) - (second.core[index] ?? 0)

    if (difference !== 0) {
      return difference
    }
  }

  if (first.prerelease.length === 0 || second.prerelease.length === 0) {
    return second.prerelease.length - first.prerelease.length
  }

  const identifierCount = Math.max(first.prerelease.length, second.prerelease.length)

  for (let index = 0; index < identifierCount; index += 1) {
    const firstIdentifier = first.prerelease[index]
    const secondIdentifier = second.prerelease[index]

    if (firstIdentifier === undefined || secondIdentifier === undefined) {
      return first.prerelease.length - second.prerelease.length
    }

    const firstNumber = /^\d+$/.test(firstIdentifier) ? Number(firstIdentifier) : undefined
    const secondNumber = /^\d+$/.test(secondIdentifier) ? Number(secondIdentifier) : undefined

    if (firstNumber !== undefined && secondNumber !== undefined) {
      if (firstNumber !== secondNumber) {
        return firstNumber - secondNumber
      }
    } else if (firstNumber !== undefined) {
      return -1
    } else if (secondNumber !== undefined) {
      return 1
    } else if (firstIdentifier !== secondIdentifier) {
      return firstIdentifier < secondIdentifier ? -1 : 1
    }
  }

  return 0
}

function isReleaseDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false
  }

  const date = new Date(`${value}T00:00:00.000Z`)

  return !Number.isNaN(date.valueOf()) && date.toISOString().startsWith(value)
}

export function validateReleaseNotes(
  releaseNotes: readonly ReleaseNote[],
  applicationVersion: string
): readonly string[] {
  const issues: string[] = []

  if (releaseNotes[0]?.version !== applicationVersion) {
    issues.push('The latest Release Note version must match the application version.')
  }

  if (new Set(releaseNotes.map((releaseNote) => releaseNote.version)).size !== releaseNotes.length) {
    issues.push('Release Note versions must be unique.')
  }

  if (releaseNotes.some((releaseNote) => !isSemanticVersion(releaseNote.version))) {
    issues.push('Each Release Note requires a semantic version.')
  }

  if (releaseNotes.some((releaseNote) => !isReleaseDate(releaseNote.releaseDate))) {
    issues.push('Each Release Note requires a valid release date.')
  }

  if (releaseNotes.some((releaseNote) => releaseNote.summary.trim().length === 0)) {
    issues.push('Each Release Note requires a summary.')
  }

  if (
    releaseNotes.some(
      (releaseNote) =>
        releaseNote.changes.new.length + releaseNote.changes.improved.length + releaseNote.changes.fixed.length === 0
    )
  ) {
    issues.push('Each Release Note requires at least one non-empty change group.')
  }

  if (
    releaseNotes.some((releaseNote) =>
      [...releaseNote.changes.new, ...releaseNote.changes.improved, ...releaseNote.changes.fixed].some(
        (change) => change.trim().length === 0
      )
    )
  ) {
    issues.push('Release Note change items must not be empty.')
  }

  if (
    releaseNotes.some(
      (releaseNote, index) =>
        index > 0 && compareReleaseVersions(releaseNotes[index - 1]!.version, releaseNote.version) <= 0
    )
  ) {
    issues.push('Release Notes must be ordered newest-first.')
  }

  return issues
}
