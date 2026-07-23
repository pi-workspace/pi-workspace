import { execFile } from 'node:child_process'
import { realpath } from 'node:fs/promises'
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import { worktreeName } from './workstream-id'

const exec = promisify(execFile)

export type InspectedGitRepository = Readonly<{
  directoryPath: string
  commonDirectoryPath: string
}>

export type WorktreeProposal = Readonly<{
  repositoryId: string
  sourcePath: string
  commonDirectoryPath: string
  worktreePath: string
  branch: string
  baseCommit: string
}>

export async function proposeWorktree(options: {
  repositoryId: string
  repositoryPath: string
  workstreamId: string
}): Promise<WorktreeProposal> {
  const repository = await inspectGitRepository(options.repositoryPath)
  const { stdout } = await exec('git', ['-C', repository.directoryPath, 'rev-parse', 'HEAD']).catch(() => {
    throw new TypeError('The Repository does not have a commit from which to create a worktree.')
  })
  const baseCommit = stdout.trim()

  if (!baseCommit) throw new TypeError('The Repository does not have a commit from which to create a worktree.')

  return {
    repositoryId: options.repositoryId,
    sourcePath: repository.directoryPath,
    commonDirectoryPath: repository.commonDirectoryPath,
    worktreePath: join(
      dirname(repository.directoryPath),
      '.worktrees',
      worktreeName(options.workstreamId),
      options.repositoryId
    ),
    branch: `pi-workspace/${worktreeName(options.workstreamId)}/${options.repositoryId}`,
    baseCommit,
  }
}

export async function inspectWorktree(options: {
  worktreePath: string
  commonDirectoryPath: string
  expectedBranch?: string
}): Promise<'available' | 'unavailable'> {
  try {
    const repository = await inspectGitRepository(options.worktreePath)

    if (repository.commonDirectoryPath !== options.commonDirectoryPath) return 'unavailable'
    if (!options.expectedBranch) return 'available'

    const { stdout } = await exec('git', ['-C', options.worktreePath, 'branch', '--show-current'])

    return stdout.trim() === options.expectedBranch ? 'available' : 'unavailable'
  } catch {
    return 'unavailable'
  }
}

export async function createWorktree(proposal: WorktreeProposal): Promise<WorktreeProposal> {
  try {
    await exec('git', [
      '-C',
      proposal.sourcePath,
      'worktree',
      'add',
      '-b',
      proposal.branch,
      proposal.worktreePath,
      proposal.baseCommit,
    ])
  } catch (error) {
    const detail = error instanceof Error && 'stderr' in error ? String(error.stderr).trim() : ''
    throw new Error(detail || `Git could not create the worktree at ${proposal.worktreePath}.`, { cause: error })
  }

  const availability = await inspectWorktree({
    worktreePath: proposal.worktreePath,
    commonDirectoryPath: proposal.commonDirectoryPath,
    expectedBranch: proposal.branch,
  })
  if (availability !== 'available') {
    throw new Error(`Git created the worktree at ${proposal.worktreePath}, but Pi Workspace could not verify it.`)
  }

  return proposal
}

export async function inspectGitRepository(selectedDirectoryPath: string): Promise<InspectedGitRepository> {
  const canonicalSelectedDirectoryPath = await realpath(selectedDirectoryPath).catch(() => {
    throw new TypeError('Select an existing local Git Repository.')
  })

  if (canonicalSelectedDirectoryPath === parse(canonicalSelectedDirectoryPath).root) {
    throw new TypeError('A filesystem root cannot be registered as a Repository.')
  }

  try {
    const { stdout } = await exec('git', [
      '-C',
      canonicalSelectedDirectoryPath,
      'rev-parse',
      '--path-format=absolute',
      '--show-toplevel',
      '--git-common-dir',
    ])
    const [rootPath, commonDirectoryPath] = stdout.trim().split(/\r?\n/)

    if (!rootPath || !commonDirectoryPath) {
      throw new Error('Git did not identify a Repository.')
    }

    const canonicalRootPath = await realpath(rootPath)
    const resolvedCommonDirectoryPath = isAbsolute(commonDirectoryPath)
      ? commonDirectoryPath
      : resolve(canonicalRootPath, commonDirectoryPath)

    return {
      directoryPath: canonicalRootPath,
      commonDirectoryPath: await realpath(resolvedCommonDirectoryPath),
    }
  } catch {
    throw new TypeError('Select a local Git Repository.')
  }
}

export function repositoryRootsOverlap(leftDirectoryPath: string, rightDirectoryPath: string): boolean {
  return isWithin(leftDirectoryPath, rightDirectoryPath) || isWithin(rightDirectoryPath, leftDirectoryPath)
}

function isWithin(candidatePath: string, parentPath: string): boolean {
  const relativePath = relative(parentPath, candidatePath)

  return (
    relativePath === '' || (!relativePath.startsWith(`..${sep}`) && relativePath !== '..' && !isAbsolute(relativePath))
  )
}
