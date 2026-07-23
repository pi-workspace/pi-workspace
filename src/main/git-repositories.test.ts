import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, parse } from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'
import { createWorktree, inspectGitRepository, proposeWorktree, repositoryRootsOverlap } from './git-repositories'

const exec = promisify(execFile)

test('recognizes a Repository nested within another Repository path', () => {
  const parentDirectoryPath = join(tmpdir(), 'Pi Workspace')
  const childDirectoryPath = join(parentDirectoryPath, 'nested', 'Repository')

  assert.equal(repositoryRootsOverlap(parentDirectoryPath, childDirectoryPath), true)
  assert.equal(repositoryRootsOverlap(childDirectoryPath, parentDirectoryPath), true)
  assert.equal(repositoryRootsOverlap(parentDirectoryPath, join(tmpdir(), 'Pi Workspace Other')), false)
})

async function createRepository(): Promise<string> {
  const rootPath = await mkdtemp(join(tmpdir(), 'pi-workspace-repository-'))
  const directoryPath = join(rootPath, 'repository')
  await exec('git', ['init', directoryPath])
  return realpath(directoryPath)
}

test('resolves a selected Repository subdirectory to its canonical Git root and common directory', async () => {
  const repositoryPath = await createRepository()
  const selectedDirectoryPath = join(repositoryPath, 'nested', 'directory')
  await mkdir(selectedDirectoryPath, { recursive: true })

  const repository = await inspectGitRepository(selectedDirectoryPath)

  assert.equal(repository.directoryPath, await realpath(repositoryPath))
  assert.match(repository.commonDirectoryPath, /\.git$/)
})

test('rejects a non-Git directory without changing it', async () => {
  const directoryPath = await mkdtemp(join(tmpdir(), 'pi-workspace-not-git-'))
  const filePath = join(directoryPath, 'unchanged.txt')
  await writeFile(filePath, 'unchanged')

  await assert.rejects(() => inspectGitRepository(directoryPath), /Git Repository/)
  assert.equal(await readFile(filePath, 'utf8'), 'unchanged')
})

test('rejects a filesystem root as a Repository', async () => {
  await assert.rejects(() => inspectGitRepository(parse(tmpdir()).root), /filesystem root/)
})

test('creates a deterministic ordinary worktree without changing dirty source files', async () => {
  const repositoryPath = await createRepository()
  await writeFile(join(repositoryPath, 'tracked.txt'), 'committed')
  await exec('git', ['-C', repositoryPath, 'add', 'tracked.txt'])
  await exec('git', [
    '-C',
    repositoryPath,
    '-c',
    'user.name=Pi Workspace tests',
    '-c',
    'user.email=tests@pi-workspace.invalid',
    'commit',
    '-m',
    'Initial commit',
  ])
  await writeFile(join(repositoryPath, 'tracked.txt'), 'dirty source')

  const proposal = await proposeWorktree({
    repositoryId: 'repository-a',
    repositoryPath,
    workstreamId: '018f35d8-4b2c-7abc-8def-0123456789ab',
  })
  const created = await createWorktree(proposal)

  assert.equal(created, proposal)
  assert.equal(proposal.worktreePath, join(parse(repositoryPath).dir, '.worktrees', '0123456789ab', 'repository-a'))
  assert.equal(await readFile(join(repositoryPath, 'tracked.txt'), 'utf8'), 'dirty source')
  assert.equal(await readFile(join(proposal.worktreePath, 'tracked.txt'), 'utf8'), 'committed')
  assert.equal(
    (await exec('git', ['-C', proposal.worktreePath, 'branch', '--show-current'])).stdout.trim(),
    proposal.branch
  )
})
