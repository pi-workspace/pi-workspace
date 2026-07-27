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
    version: '2.0.0-beta.1',
    releaseDate: '2026-07-27',
    summary:
      'This beta gives each Workstream a clearer Repository boundary and puts branching, review, and delivery controls directly in every Session.',
    changes: {
      new: [
        'Compact eligible Session context on demand and revisit the retained summary in the Session transcript.',
        'Act on or dismiss a suggested next step to prepare a draft pull request after completing changes.',
        'See automatically maintained descriptions of each Session’s current focus in the sidebar.',
        'Review Session Repository changes in expandable diffs, stage whole files, add hunk comments or follow-ups, and revisit operation-time code previews from Agent Activities.',
        'Fork a Session from any completed user message while preserving the original Session and carrying its earlier history into an independent Session.',
        'Reference scoped files and folders with @ in Composer to include their current context in messages and follow-ups.',
      ],
      improved: [
        'Workstreams now select their own Repositories and share the goal and Repository context across mode-free Sessions; Brainstorm and Implement modes and the Workstream Knowledge panel have been removed.',
        'Workstream Sessions now use current checkouts by default, show each Repository’s live branch and working location beneath Composer, and let you explicitly create an isolated Session Worktree.',
        'Sessions load faster as their histories grow, and Composer stays responsive without losing current edits.',
        'Repository work now receives a final pass of relevant locally runnable CI and GitHub Actions before completion.',
        'Sidebar controls are simpler, and Composer now floats above the transcript on a translucent surface.',
      ],
      fixed: [
        'Linux app stores now show Railyard’s package description without stray replacement characters.',
        'Agent Activities can now start and complete after Workspace Repository access changes.',
      ],
    },
  },
  {
    version: '1.0.0-beta.1',
    releaseDate: '2026-07-25',
    summary: 'This beta establishes the foundation for Railyard’s next stage of development.',
    changes: {
      new: [],
      improved: [
        'Pi Workspace is now Railyard, with a renamed app and packages, new native icons, Space Grotesk and IBM Plex Mono typography, and refreshed light and dark visuals; first launch copies existing Workspaces, Sessions, and appearance settings into the renamed app.',
      ],
      fixed: [],
    },
  },
  {
    version: '0.6.0-beta.1',
    releaseDate: '2026-07-25',
    summary:
      'This beta expands Pi Workspace to Windows and makes it easier to keep work moving across active Sessions.',
    changes: {
      new: [
        'Install Pi Workspace on Windows 11 x64 and work with Repositories whose paths include drive letters and spaces.',
        'Queue up to three follow-up messages while a Session is working, keep them across restarts, and resume them when ready.',
      ],
      improved: [
        'Debian package details now better explain Pi Workspace and its Workspace, Session, and provider configuration.',
      ],
      fixed: [],
    },
  },
  {
    version: '0.5.0-beta.1',
    releaseDate: '2026-07-24',
    summary: 'This beta adds appearance customization and brings Workspace and application controls together.',
    changes: {
      new: ['Choose from six visual themes and color modes in Settings, with your preferences saved across launches.'],
      improved: [
        'Manage Workspace Repositories from Workspace settings and open application Settings or Release notes from the sidebar footer.',
        'Changelog and Composer controls now use a cleaner, more focused layout.',
      ],
      fixed: ['Copying Markdown code blocks now works without a browser permission failure.'],
    },
  },
  {
    version: '0.4.0-beta.1',
    releaseDate: '2026-07-23',
    summary: 'This beta makes it easier to prepare changes in different Repositories at the same time.',
    changes: {
      new: [
        'Implement Sessions now create a separate Repository worktree only when Pi prepares that Repository for changes.',
      ],
      improved: [],
      fixed: [
        'Sessions with separate Repository worktrees can now run at the same time while shared working paths remain protected.',
      ],
    },
  },
  {
    version: '0.3.0-beta.1',
    releaseDate: '2026-07-23',
    summary: 'This beta makes it easier to keep track of available context during a Session.',
    changes: {
      new: ['See current Session context-window usage in Composer, including used and remaining capacity.'],
      improved: [],
      fixed: [],
    },
  },
  {
    version: '0.2.0-beta.1',
    releaseDate: '2026-07-22',
    summary: 'This beta adds Skills to help guide Pi in a Session.',
    changes: {
      new: ['Choose an available Skill from Composer autocomplete to guide Pi in a Session.'],
      improved: [],
      fixed: [],
    },
  },
  {
    version: '0.1.1-beta.1',
    releaseDate: '2026-07-21',
    summary: 'A focused beta update improves the visual clarity of dialogs.',
    changes: {
      new: [],
      improved: [],
      fixed: ['Dialogs now use an opaque background for clearer focus.'],
    },
  },
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
