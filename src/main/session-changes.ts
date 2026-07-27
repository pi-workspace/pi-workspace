import { execFile } from 'node:child_process'
import { isAbsolute, normalize, sep } from 'node:path'
import { promisify } from 'node:util'
import type {
  SessionChangeFile,
  SessionChangeFileStatus,
  SessionChangesBranch,
  SessionFileDiff,
  SessionFileDiffView,
  SessionRepositoryChanges,
} from '@/src/session-changes'

const exec = promisify(execFile)
const gitTimeout = 10_000
const maximumGitOutput = 2 * 1024 * 1024
const maximumDiffLength = 500_000

export type SessionChangeRepository = Readonly<{
  repositoryId: string
  repositoryName: string
  workingPath: string
}>

type ParsedGitStatus = Readonly<{
  branch: SessionChangesBranch
  files: readonly SessionChangeFile[]
}>

export function parseGitStatus(output: string): ParsedGitStatus {
  const records = output.split('\0')
  const branch: {
    head: string
    upstream?: string
    ahead: number
    behind: number
    detached: boolean
    unborn: boolean
  } = { head: 'HEAD', ahead: 0, behind: 0, detached: false, unborn: false }
  const files: SessionChangeFile[] = []

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]
    if (!record) continue

    if (record.startsWith('# branch.oid ')) {
      branch.unborn = record.slice(13) === '(initial)'
      continue
    }
    if (record.startsWith('# branch.head ')) {
      const head = record.slice(14)
      branch.detached = head === '(detached)'
      branch.head = branch.detached ? 'Detached HEAD' : head
      continue
    }
    if (record.startsWith('# branch.upstream ')) {
      branch.upstream = record.slice(18)
      continue
    }
    if (record.startsWith('# branch.ab ')) {
      const match = record.match(/^# branch\.ab \+(\d+) -(\d+)$/)
      if (match) {
        branch.ahead = Number(match[1])
        branch.behind = Number(match[2])
      }
      continue
    }
    if (record.startsWith('? ')) {
      files.push({ path: record.slice(2), status: 'untracked', staged: false, unstaged: true })
      continue
    }
    if (record.startsWith('u ')) {
      const fields = record.split(' ')
      const path = fields.slice(10).join(' ')
      if (path) files.push({ path, status: 'conflicted', staged: true, unstaged: true })
      continue
    }
    if (record.startsWith('1 ') || record.startsWith('2 ')) {
      const renamed = record.startsWith('2 ')
      const fields = record.split(' ')
      const state = fields[1] ?? '..'
      const path = fields.slice(renamed ? 9 : 8).join(' ')
      const previousPath = renamed ? records[++index] : undefined
      if (!path) continue

      files.push({
        path,
        ...(previousPath ? { previousPath } : {}),
        status: fileStatus(state, renamed),
        staged: state[0] !== '.',
        unstaged: state[1] !== '.',
      })
    }
  }

  return { branch, files }
}

export async function inspectRepositoryChanges(repository: SessionChangeRepository): Promise<SessionRepositoryChanges> {
  try {
    const status = await runGit(repository.workingPath, ['status', '--porcelain=v2', '--branch', '-z'])
    const parsed = parseGitStatus(status)
    const numbers = await readNumstat(repository.workingPath, parsed.branch.unborn)

    return {
      repositoryId: repository.repositoryId,
      repositoryName: repository.repositoryName,
      branch: parsed.branch,
      files: parsed.files.map((file) => ({ ...file, ...numbers.get(file.path) })),
    }
  } catch (error) {
    return {
      repositoryId: repository.repositoryId,
      repositoryName: repository.repositoryName,
      branch: { head: 'Unavailable', ahead: 0, behind: 0, detached: false, unborn: false },
      files: [],
      error: error instanceof Error ? error.message : 'Git changes are unavailable.',
    }
  }
}

export async function setRepositoryFileStaged(
  repository: SessionChangeRepository,
  request: Readonly<{ path: string; staged: boolean }>
): Promise<void> {
  if (!isSafeRelativePath(request.path)) throw new Error('The changed file is no longer available.')

  const status = parseGitStatus(await runGit(repository.workingPath, ['status', '--porcelain=v2', '--branch', '-z']))
  const file = status.files.find((candidate) => candidate.path === request.path)
  if (!file) throw new Error('The changed file is no longer available.')
  if (file.status === 'conflicted') throw new Error('Resolve the conflict before staging this file.')

  if ((request.staged && !file.unstaged) || (!request.staged && !file.staged)) return

  const paths = [
    file.path,
    ...(file.status === 'renamed' && file.previousPath && isSafeRelativePath(file.previousPath)
      ? [file.previousPath]
      : []),
  ]
  if (request.staged) {
    await runGit(repository.workingPath, ['add', '--all', '--', ...paths])
    return
  }

  if (status.branch.unborn) {
    await runGit(repository.workingPath, ['rm', '--cached', '--ignore-unmatch', '--', ...paths])
    return
  }

  await runGit(repository.workingPath, ['restore', '--staged', '--', ...paths])
}

export async function loadRepositoryFileDiff(
  repository: SessionChangeRepository,
  request: Readonly<{ path: string; view: SessionFileDiffView }>
): Promise<SessionFileDiff> {
  if (!isSafeRelativePath(request.path)) return unavailableFile()

  try {
    const status = parseGitStatus(await runGit(repository.workingPath, ['status', '--porcelain=v2', '--branch', '-z']))
    const file = status.files.find((candidate) => candidate.path === request.path)
    if (!file) return unavailableFile()
    if (request.view === 'staged' && !file.staged) return unavailableFile()
    if (request.view === 'unstaged' && !file.unstaged) return unavailableFile()

    let content: string
    if (file.status === 'untracked') {
      if (request.view === 'staged') return unavailableFile()
      content = await runUntrackedDiff(repository.workingPath, file.path)
    } else {
      const arguments_ = ['diff', '--no-ext-diff', '--no-color', '--unified=3']
      if (request.view === 'staged') arguments_.push('--cached')
      else if (request.view === 'all' && !status.branch.unborn) arguments_.push('HEAD')
      else if (request.view === 'all' && status.branch.unborn) arguments_.push('--cached')
      arguments_.push('--', file.path)
      content = await runGit(repository.workingPath, arguments_)

      if (request.view === 'all' && status.branch.unborn && file.unstaged) {
        content += await runGit(repository.workingPath, [
          'diff',
          '--no-ext-diff',
          '--no-color',
          '--unified=3',
          '--',
          file.path,
        ])
      }
    }

    if (/^Binary files .* differ$/m.test(content) || /^GIT binary patch$/m.test(content)) {
      return { status: 'binary', message: 'Binary files cannot be previewed.' }
    }
    if (content.length > maximumDiffLength) {
      return {
        status: 'too-large',
        content: `${content.slice(0, maximumDiffLength)}\n…`,
        truncated: true,
        message: 'The diff was truncated because it is too large to preview.',
      }
    }

    return { status: 'available', content, truncated: false }
  } catch (error) {
    return {
      status: 'unavailable',
      message: error instanceof Error ? error.message : 'The diff is unavailable.',
    }
  }
}

async function readNumstat(workingPath: string, unborn: boolean): Promise<Map<string, Partial<SessionChangeFile>>> {
  const outputs = await Promise.all([
    runGit(workingPath, ['diff', '--numstat', '--no-renames']).catch(() => ''),
    runGit(workingPath, ['diff', '--cached', '--numstat', '--no-renames', ...(unborn ? [] : ['HEAD'])]).catch(() => ''),
  ])
  const totals = new Map<string, { additions: number; deletions: number; binary?: boolean }>()

  for (const output of outputs) {
    for (const line of output.split(/\r?\n/)) {
      const [added, deleted, ...pathParts] = line.split('\t')
      const path = pathParts.join('\t')
      if (!path) continue
      const current = totals.get(path) ?? { additions: 0, deletions: 0 }
      if (added === '-' || deleted === '-') current.binary = true
      else {
        current.additions += Number(added)
        current.deletions += Number(deleted)
      }
      totals.set(path, current)
    }
  }

  return totals
}

function fileStatus(state: string, renamed: boolean): SessionChangeFileStatus {
  if (state.includes('U') || state === 'AA' || state === 'DD') return 'conflicted'
  if (renamed || state.includes('R')) return 'renamed'
  if (state.includes('C')) return 'copied'
  if (state.includes('A')) return 'added'
  if (state.includes('D')) return 'deleted'
  return 'modified'
}

function isSafeRelativePath(path: string): boolean {
  const normalized = normalize(path)
  return Boolean(path) && !isAbsolute(path) && normalized !== '..' && !normalized.startsWith(`..${sep}`)
}

function unavailableFile(): SessionFileDiff {
  return { status: 'unavailable', message: 'The changed file is no longer available.' }
}

async function runUntrackedDiff(workingPath: string, path: string): Promise<string> {
  try {
    const { stdout } = await exec(
      'git',
      [
        '-C',
        workingPath,
        'diff',
        '--no-index',
        '--no-color',
        '--unified=3',
        '--',
        process.platform === 'win32' ? 'NUL' : '/dev/null',
        path,
      ],
      { encoding: 'utf8', timeout: gitTimeout, maxBuffer: maximumGitOutput, windowsHide: true }
    )

    return stdout
  } catch (error) {
    if (isGitDifference(error)) return error.stdout

    const detail = error instanceof Error && 'stderr' in error ? String(error.stderr).trim() : ''
    throw new Error(detail || 'Git changes are unavailable.', { cause: error })
  }
}

async function runGit(workingPath: string, arguments_: readonly string[]): Promise<string> {
  try {
    const { stdout } = await exec('git', ['-C', workingPath, ...arguments_], {
      encoding: 'utf8',
      timeout: gitTimeout,
      maxBuffer: maximumGitOutput,
      windowsHide: true,
    })
    return stdout
  } catch (error) {
    const detail = error instanceof Error && 'stderr' in error ? String(error.stderr).trim() : ''
    throw new Error(detail || 'Git changes are unavailable.', { cause: error })
  }
}

function isGitDifference(error: unknown): error is Error & { code: number; stdout: string } {
  return (
    error instanceof Error &&
    'code' in error &&
    error.code === 1 &&
    'stdout' in error &&
    typeof error.stdout === 'string'
  )
}
