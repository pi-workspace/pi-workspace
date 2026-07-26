import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'
import { inspectRepositoryChanges, loadRepositoryFileDiff, parseGitStatus } from './session-changes'

const exec = promisify(execFile)

async function createRepository(): Promise<string> {
  const directoryPath = await mkdtemp(join(tmpdir(), 'railyard-changes-'))
  await exec('git', ['init', directoryPath])
  await exec('git', ['-C', directoryPath, 'config', 'user.name', 'Railyard tests'])
  await exec('git', ['-C', directoryPath, 'config', 'user.email', 'tests@railyard.invalid'])
  await writeFile(join(directoryPath, 'tracked.txt'), 'first\n')
  await exec('git', ['-C', directoryPath, 'add', 'tracked.txt'])
  await exec('git', ['-C', directoryPath, 'commit', '-m', 'Initial'])

  return directoryPath
}

test('parses staged, unstaged, untracked, renamed, and conflicted porcelain-v2 records', () => {
  const status = [
    '# branch.oid abc',
    '# branch.head main',
    '# branch.upstream origin/main',
    '# branch.ab +2 -1',
    '1 M. N... 100644 100644 100644 abc def staged.ts',
    '1 .M N... 100644 100644 100644 abc def unstaged.ts',
    '2 R. N... 100644 100644 100644 abc def R100 renamed.ts',
    'old.ts',
    'u UU N... 100644 100644 100644 100644 abc def ghi conflict.ts',
    '? new.ts',
    '',
  ].join('\0')

  const parsed = parseGitStatus(status)

  assert.deepEqual(parsed.branch, {
    head: 'main',
    upstream: 'origin/main',
    ahead: 2,
    behind: 1,
    detached: false,
    unborn: false,
  })
  assert.deepEqual(
    parsed.files.map(({ path, previousPath, status, staged, unstaged }) => ({
      path,
      previousPath,
      status,
      staged,
      unstaged,
    })),
    [
      { path: 'staged.ts', previousPath: undefined, status: 'modified', staged: true, unstaged: false },
      { path: 'unstaged.ts', previousPath: undefined, status: 'modified', staged: false, unstaged: true },
      { path: 'renamed.ts', previousPath: 'old.ts', status: 'renamed', staged: true, unstaged: false },
      { path: 'conflict.ts', previousPath: undefined, status: 'conflicted', staged: true, unstaged: true },
      { path: 'new.ts', previousPath: undefined, status: 'untracked', staged: false, unstaged: true },
    ]
  )
})

test('inspects staged and unstaged state once per changed file', async () => {
  const workingPath = await createRepository()
  await writeFile(join(workingPath, 'tracked.txt'), 'staged\n')
  await exec('git', ['-C', workingPath, 'add', 'tracked.txt'])
  await writeFile(join(workingPath, 'tracked.txt'), 'staged\nunstaged\n')
  await writeFile(join(workingPath, 'untracked.txt'), 'new\n')

  const changes = await inspectRepositoryChanges({
    repositoryId: 'repository',
    repositoryName: 'Repository',
    workingPath,
  })

  assert.equal(changes.error, undefined)
  assert.deepEqual(
    changes.files.map(({ path, staged, unstaged }) => ({ path, staged, unstaged })),
    [
      { path: 'tracked.txt', staged: true, unstaged: true },
      { path: 'untracked.txt', staged: false, unstaged: true },
    ]
  )
})

test('loads bounded unified diffs and rejects paths outside current changes', async () => {
  const workingPath = await createRepository()
  await writeFile(join(workingPath, 'tracked.txt'), 'changed\n')

  const diff = await loadRepositoryFileDiff(
    { repositoryId: 'repository', repositoryName: 'Repository', workingPath },
    { path: 'tracked.txt', view: 'all' }
  )

  assert.equal(diff.status, 'available')
  assert.match(diff.content ?? '', /^diff --git/m)
  assert.equal(diff.truncated, false)

  const denied = await loadRepositoryFileDiff(
    { repositoryId: 'repository', repositoryName: 'Repository', workingPath },
    { path: '../secret', view: 'all' }
  )
  assert.deepEqual(denied, { status: 'unavailable', message: 'The changed file is no longer available.' })
})

test('reports binary and oversized diffs without rendering them as ordinary text', async () => {
  const workingPath = await createRepository()
  await writeFile(join(workingPath, 'tracked.txt'), Buffer.from([0, 1, 2, 3]))

  const binary = await loadRepositoryFileDiff(
    { repositoryId: 'repository', repositoryName: 'Repository', workingPath },
    { path: 'tracked.txt', view: 'all' }
  )

  assert.equal(binary.status, 'binary')

  await writeFile(join(workingPath, 'large.txt'), 'x'.repeat(600_000))
  const oversized = await loadRepositoryFileDiff(
    { repositoryId: 'repository', repositoryName: 'Repository', workingPath },
    { path: 'large.txt', view: 'all' }
  )

  assert.equal(oversized.status, 'too-large')
  assert.equal(oversized.truncated, true)
})

test('returns a per-Repository error when Git inspection fails', async () => {
  const changes = await inspectRepositoryChanges({
    repositoryId: 'missing',
    repositoryName: 'Missing',
    workingPath: join(tmpdir(), 'missing-railyard-repository'),
  })

  assert.equal(changes.repositoryId, 'missing')
  assert.ok(changes.error)
  assert.deepEqual(changes.files, [])
})

test('supports an unborn HEAD and an untracked file preview', async () => {
  const workingPath = await mkdtemp(join(tmpdir(), 'railyard-unborn-'))
  await exec('git', ['init', workingPath])
  await writeFile(join(workingPath, 'new.txt'), 'new file\n')

  const changes = await inspectRepositoryChanges({
    repositoryId: 'repository',
    repositoryName: 'Repository',
    workingPath,
  })
  const diff = await loadRepositoryFileDiff(
    { repositoryId: 'repository', repositoryName: 'Repository', workingPath },
    { path: 'new.txt', view: 'all' }
  )

  assert.equal(changes.branch.unborn, true)
  assert.equal(diff.status, 'available')
  assert.match(diff.content ?? '', /\+new file/)
})
