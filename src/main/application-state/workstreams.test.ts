import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, test } from 'node:test'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import type { SessionId } from '@/src/domain/session'
import { createWorktree, inspectGitRepository, type InspectedGitRepository } from '@/src/main/git-repositories'
import { createPiSessionFileStore, type PiSessionFileStore } from '@/src/main/pi-session-files'
import { createPiSessionRuntimeRegistry } from '@/src/main/pi-session-runtimes'
import { worktreeName } from '@/src/main/workstream-id'
import { initializeApplicationAuthority, type SqliteModule } from './index'

const exec = promisify(execFile)
const temporaryDirectories: string[] = []

type BunSqliteModule = Readonly<{ Database: SqliteModule['DatabaseSync'] }>
type RepositoryInspector = (directoryPath: string) => Promise<InspectedGitRepository>
const { Database } = (await Function('return import("bun:sqlite")')()) as BunSqliteModule
const bunSqlite: SqliteModule = {
  DatabaseSync: Database as unknown as SqliteModule['DatabaseSync'],
  async backup() {
    throw new Error('Backup is not exercised by the Bun test adapter.')
  },
}

afterEach(async () => {
  const directories = temporaryDirectories.splice(0)
  // Bun's SQLite adapter retains database handles until the test process ends on Windows.
  if (process.platform === 'win32') return

  await Promise.all(directories.map((directory) => rm(directory, { force: true, recursive: true, maxRetries: 5 })))
})

async function createFixture(sessionFiles?: PiSessionFileStore, inspectRepository?: RepositoryInspector) {
  const storageDirectory = await realpath(await mkdtemp(join(tmpdir(), 'pi-workspace-workstreams-')))
  temporaryDirectories.push(storageDirectory)
  const repositoryPath = join(storageDirectory, 'repository')
  await exec('git', ['init', repositoryPath])
  const authority = await initializeApplicationAuthority(storageDirectory, {
    sqlite: bunSqlite,
    sessionFiles,
    inspectRepository,
  })
  const workspaces = await authority.createWorkspace('Workspace', [repositoryPath])
  const workspace = workspaces.workspaces[0]
  assert.ok(workspace)

  return { authority, storageDirectory, workspace }
}

async function commitRepositoryFile(
  repositoryPath: string,
  fileName: string,
  contents: string,
  message: string
): Promise<void> {
  await writeFile(join(repositoryPath, fileName), contents)
  await exec('git', ['-C', repositoryPath, 'add', fileName])
  await exec('git', [
    '-C',
    repositoryPath,
    '-c',
    'user.name=Pi Workspace tests',
    '-c',
    'user.email=tests@pi-workspace.invalid',
    'commit',
    '-m',
    message,
  ])
}

async function createInterruptedSessionWorktreeFixture() {
  const storageDirectory = await realpath(await mkdtemp(join(tmpdir(), 'pi-workspace-session-worktree-retry-')))
  temporaryDirectories.push(storageDirectory)
  const repositoryPath = join(storageDirectory, 'repository')
  await exec('git', ['init', repositoryPath])
  await commitRepositoryFile(repositoryPath, 'tracked.txt', 'committed', 'Initial commit')
  const interrupted = await initializeApplicationAuthority(storageDirectory, {
    sqlite: bunSqlite,
    createWorktree: async (proposal) => {
      await createWorktree(proposal)
      throw new Error('simulated crash after Git worktree creation')
    },
  })
  const workspace = (await interrupted.createWorkspace('Workspace', [repositoryPath])).workspaces[0]!
  const repository = workspace.repositories[0]!
  const created = await interrupted.createWorkstream(workspace.id, { goal: 'Recover Session preparation' })
  await assert.rejects(interrupted.prepareSessionRepository(created.sessionId, repository.id), /simulated crash/)

  return { storageDirectory, repositoryPath, interrupted, repository, created }
}

test('reset preserves external Git and Pi Session artifacts without adopting them', async () => {
  const { authority, storageDirectory, workspace } = await createFixture()
  const repository = workspace.repositories[0]
  assert.ok(repository)
  const created = await authority.createWorkstream(workspace.id, { goal: 'Preserve external artifacts' })
  const resolution = await authority.resolveOwnedSession(created.sessionId)
  assert.ok(resolution)
  const reset = await authority.reset()

  assert.deepEqual(reset, { status: 'first-launch' })
  await Promise.all([access(repository.directoryPath), access(resolution.sessionPath)])
  assert.deepEqual((await authority.getWorkspaces()).workspaces, [])
  assert.equal(await authority.resolveOwnedSession(created.sessionId), undefined)
  assert.equal((await initializeApplicationAuthority(storageDirectory, { sqlite: bunSqlite })).startup.status, 'ready')
})

test('reset creates a new application authority generation', async () => {
  const { authority, storageDirectory } = await createFixture()
  const markerPath = join(storageDirectory, 'application-state.json')
  const before = JSON.parse(await readFile(markerPath, 'utf8')) as { generationId: string }

  await authority.reset()

  const after = JSON.parse(await readFile(markerPath, 'utf8')) as { generationId: string }
  assert.notEqual(after.generationId, before.generationId)
})

test('reset backs up the prior SQLite generation before replacing it', async () => {
  const storageDirectory = await mkdtemp(join(tmpdir(), 'pi-workspace-reset-backup-'))
  temporaryDirectories.push(storageDirectory)
  let backedUpGeneration: string | undefined
  const sqlite: SqliteModule = {
    DatabaseSync: bunSqlite.DatabaseSync,
    async backup(source, destination) {
      backedUpGeneration = String(source.prepare("SELECT value FROM metadata WHERE key = 'generation_id'").get()?.value)
      await writeFile(destination, 'SQLite backup')
    },
  }
  const authority = await initializeApplicationAuthority(storageDirectory, { sqlite })
  const markerPath = join(storageDirectory, 'application-state.json')
  const before = JSON.parse(await readFile(markerPath, 'utf8')) as { generationId: string }

  await authority.reset()

  assert.equal(backedUpGeneration, before.generationId)
})

test('creates a Workstream with exactly one default Implement Session', async () => {
  const { authority, workspace } = await createFixture()

  const created = await authority.createWorkstream(workspace.id, { goal: 'Ship cancellation reasons' })
  const workstream = created.snapshot.workstreams[0]

  assert.equal(workstream?.goal, 'Ship cancellation reasons')
  assert.equal(workstream?.workingLocation, 'current-checkouts')
  assert.deepEqual(workstream?.repositoryWorkingLocations, [
    {
      repositoryId: workspace.repositories[0]!.id,
      repositoryName: workspace.repositories[0]!.name,
      kind: 'current-checkout',
      availability: 'available',
      workingPath: workspace.repositories[0]!.directoryPath,
    },
  ])
  assert.equal(workstream?.lifecycle, 'active')
  assert.equal(workstream?.sessions.length, 1)
  assert.equal(workstream?.sessions[0]?.mode, 'implement')
  assert.deepEqual(workstream?.sessions[0]?.repositoryAccess, { kind: 'managed' })
  assert.equal(workstream?.sessions[0]?.availability, 'available')
})

test('lazily creates a Repository worktree for an Implement Session', async () => {
  const { authority, storageDirectory, workspace } = await createFixture()
  const repository = workspace.repositories[0]!
  await writeFile(join(repository.directoryPath, 'tracked.txt'), 'committed')
  await exec('git', ['-C', repository.directoryPath, 'add', 'tracked.txt'])
  await exec('git', [
    '-C',
    repository.directoryPath,
    '-c',
    'user.name=Pi Workspace tests',
    '-c',
    'user.email=tests@pi-workspace.invalid',
    'commit',
    '-m',
    'Initial commit',
  ])
  const created = await authority.createWorkstream(workspace.id, { goal: 'Work separately' })
  const expectedPath = join(storageDirectory, '.worktrees', worktreeName(created.sessionId), repository.id)
  await assert.rejects(access(expectedPath))

  const prepared = await authority.prepareSessionRepository(created.sessionId, repository.id)

  assert.equal(prepared.workingPath, expectedPath)
  assert.equal(await readFile(join(expectedPath, 'tracked.txt'), 'utf8'), 'committed')
})

test('restores a removed Implement Session worktree from its persisted branch', async () => {
  const { authority, workspace } = await createFixture()
  const repository = workspace.repositories[0]!
  await commitRepositoryFile(repository.directoryPath, 'tracked.txt', 'committed', 'Initial commit')
  const created = await authority.createWorkstream(workspace.id, { goal: 'Restore isolated changes' })
  const prepared = await authority.prepareSessionRepository(created.sessionId, repository.id)
  await commitRepositoryFile(prepared.workingPath, 'session-change.txt', 'preserved', 'Session change')
  await exec('git', ['-C', repository.directoryPath, 'worktree', 'remove', '--force', prepared.workingPath])

  const restored = await authority.prepareSessionRepository(created.sessionId, repository.id)

  assert.equal(restored.workingPath, prepared.workingPath)
  assert.equal(await readFile(join(restored.workingPath, 'session-change.txt'), 'utf8'), 'preserved')
})

test('falls back to the source checkout immediately after a Session worktree is removed', async () => {
  const { authority, workspace } = await createFixture()
  const repository = workspace.repositories[0]!
  await commitRepositoryFile(repository.directoryPath, 'tracked.txt', 'committed', 'Initial commit')
  const created = await authority.createWorkstream(workspace.id, { goal: 'Keep Repository access current' })
  const prepared = await authority.prepareSessionRepository(created.sessionId, repository.id)
  await exec('git', ['-C', repository.directoryPath, 'worktree', 'remove', '--force', prepared.workingPath])

  const resolution = await authority.resolveOwnedSession(created.sessionId)
  const resolvedRepository = resolution?.managedPolicy?.repositories[0]

  assert.notEqual(resolution?.managedPolicy?.resourcePolicyRevision, prepared.resourcePolicyRevision)
  assert.equal(resolvedRepository?.availability, 'available')
  if (resolvedRepository?.availability === 'available') {
    assert.equal(resolvedRepository.workingPath, repository.directoryPath)
    assert.equal(resolvedRepository.workingLocation, 'source-checkout')
  }
})

test('gives each Implement Session a distinct worktree from the Repository current HEAD', async () => {
  const { authority, workspace } = await createFixture()
  const repository = workspace.repositories[0]!
  await writeFile(join(repository.directoryPath, 'first.txt'), 'first')
  await exec('git', ['-C', repository.directoryPath, 'add', 'first.txt'])
  await exec('git', [
    '-C',
    repository.directoryPath,
    '-c',
    'user.name=Pi Workspace tests',
    '-c',
    'user.email=tests@pi-workspace.invalid',
    'commit',
    '-m',
    'First commit',
  ])
  const created = await authority.createWorkstream(workspace.id, { goal: 'Prepare parallel changes' })
  const workstream = created.snapshot.workstreams[0]!
  const first = await authority.prepareSessionRepository(created.sessionId, repository.id)

  await writeFile(join(repository.directoryPath, 'second.txt'), 'second')
  await exec('git', ['-C', repository.directoryPath, 'add', 'second.txt'])
  await exec('git', [
    '-C',
    repository.directoryPath,
    '-c',
    'user.name=Pi Workspace tests',
    '-c',
    'user.email=tests@pi-workspace.invalid',
    'commit',
    '-m',
    'Second commit',
  ])
  const secondSession = await authority.createWorkstreamSession(workstream.id, { mode: 'implement' })
  const second = await authority.prepareSessionRepository(secondSession.sessionId, repository.id)

  assert.notEqual(second.workingPath, first.workingPath)
  await assert.rejects(access(join(first.workingPath, 'second.txt')))
  assert.equal(await readFile(join(second.workingPath, 'second.txt'), 'utf8'), 'second')
})

test('resolves a prepared worktree only for its owning Implement Session', async () => {
  const { authority, workspace } = await createFixture()
  const repository = workspace.repositories[0]!
  await writeFile(join(repository.directoryPath, 'tracked.txt'), 'committed')
  await exec('git', ['-C', repository.directoryPath, 'add', 'tracked.txt'])
  await exec('git', [
    '-C',
    repository.directoryPath,
    '-c',
    'user.name=Pi Workspace tests',
    '-c',
    'user.email=tests@pi-workspace.invalid',
    'commit',
    '-m',
    'Initial commit',
  ])
  const created = await authority.createWorkstream(workspace.id, { goal: 'Keep Session changes separate' })
  const workstream = created.snapshot.workstreams[0]!
  const sibling = await authority.createWorkstreamSession(workstream.id, { mode: 'implement' })
  const before = await authority.resolveOwnedSession(created.sessionId)
  const prepared = await authority.prepareSessionRepository(created.sessionId, repository.id)

  const ownerResolution = await authority.resolveOwnedSession(created.sessionId)
  const ownerRepository = ownerResolution?.managedPolicy?.repositories[0]
  const siblingRepository = (await authority.resolveOwnedSession(sibling.sessionId))?.managedPolicy?.repositories[0]

  assert.notEqual(ownerResolution?.managedPolicy?.resourcePolicyRevision, before?.managedPolicy?.resourcePolicyRevision)
  assert.equal(ownerRepository?.availability, 'available')
  if (ownerRepository?.availability === 'available') {
    assert.equal(ownerRepository.workingPath, prepared.workingPath)
    assert.equal(ownerRepository.workingLocation, 'session-worktree')
  }
  assert.equal(siblingRepository?.availability, 'available')
  if (siblingRepository?.availability === 'available') {
    assert.equal(siblingRepository.workingPath, repository.directoryPath)
    assert.equal(siblingRepository.workingLocation, 'source-checkout')
  }
})

test('does not prepare a Repository worktree for a Brainstorm Session', async () => {
  const { authority, workspace } = await createFixture()
  const repository = workspace.repositories[0]!
  const created = await authority.createWorkstream(workspace.id, {
    goal: 'Investigate without changes',
    mode: 'brainstorm',
  })

  await assert.rejects(
    authority.prepareSessionRepository(created.sessionId, repository.id),
    /Implement Session Workspace/
  )
})

test('keeps the source checkout available when Session worktree preparation is interrupted', async () => {
  const { interrupted, repositoryPath, created } = await createInterruptedSessionWorktreeFixture()

  const interruptedRepository = (await interrupted.resolveOwnedSession(created.sessionId))?.managedPolicy
    ?.repositories[0]

  assert.equal(interruptedRepository?.availability, 'available')
  if (interruptedRepository?.availability === 'available') {
    assert.equal(interruptedRepository.workingPath, repositoryPath)
    assert.equal(interruptedRepository.workingLocation, 'source-checkout')
  }
})

test('recovers a Session worktree after interrupted preparation and restart', async () => {
  const { storageDirectory, repository, created } = await createInterruptedSessionWorktreeFixture()
  const restarted = await initializeApplicationAuthority(storageDirectory, { sqlite: bunSqlite })

  const prepared = await restarted.prepareSessionRepository(created.sessionId, repository.id)
  const runtimeRepository = (await restarted.resolveOwnedSession(created.sessionId))?.managedPolicy?.repositories[0]

  assert.equal(runtimeRepository?.availability, 'available')
  if (runtimeRepository?.availability === 'available') assert.equal(runtimeRepository.workingPath, prepared.workingPath)
})

test('persists Workstream records, revisions, and mutation history across restart', async () => {
  const { authority, storageDirectory, workspace } = await createFixture()
  const created = await authority.createWorkstream(workspace.id, { goal: 'Retain structured knowledge' })
  const workstream = created.snapshot.workstreams[0]
  assert.ok(workstream)
  const session = workstream.sessions[0]
  assert.ok(session)

  const changed = await authority.applyPiWorkstreamKnowledgeCommand(
    workstream.id,
    {
      type: 'put-record',
      expectedKnowledgeRevision: 0,
      expectedRecordRevision: 0,
      record: {
        id: 'finding-a',
        kind: 'finding',
        summary: 'The service owns the contract.',
        repositoryIds: [],
        evidenceIds: [],
      },
    },
    session.id
  )

  assert.equal(changed.knowledge.knowledgeRevision, 1)
  const database = new Database(join(storageDirectory, 'application-state.sqlite'))
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM workstream_record_history').get()?.count, 1)
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM workstream_mutations').get()?.count, 1)
  database.close()

  const restarted = await initializeApplicationAuthority(storageDirectory, { sqlite: bunSqlite })
  const knowledge = await restarted.getWorkstreamKnowledge(workstream.id)
  assert.equal(knowledge.knowledgeRevision, 1)
  assert.equal(knowledge.records[0]?.kind, 'finding')
  assert.equal(knowledge.records[0]?.provenance.actor, 'pi')
})

test('rejects a stale persisted record revision after restart', async () => {
  const { authority, storageDirectory, workspace } = await createFixture()
  const created = await authority.createWorkstream(workspace.id, { goal: 'Keep record concurrency' })
  const workstream = created.snapshot.workstreams[0]!

  await authority.applyPiWorkstreamKnowledgeCommand(
    workstream.id,
    {
      type: 'put-record',
      expectedKnowledgeRevision: 0,
      expectedRecordRevision: 0,
      record: {
        id: 'finding-a',
        kind: 'finding',
        summary: 'The service owns the contract.',
        repositoryIds: [],
        evidenceIds: [],
      },
    },
    created.sessionId
  )
  const restarted = await initializeApplicationAuthority(storageDirectory, { sqlite: bunSqlite })

  await assert.rejects(
    restarted.applyUserWorkstreamKnowledgeCommand(workstream.id, {
      type: 'put-record',
      expectedKnowledgeRevision: 1,
      expectedRecordRevision: 0,
      record: {
        id: 'finding-a',
        kind: 'finding',
        summary: 'Overwrite the newer record.',
        repositoryIds: [],
        evidenceIds: [],
      },
    }),
    /record is stale/
  )
})

test('keeps decision acceptance user-only at the persisted authority boundary', async () => {
  const { authority, workspace } = await createFixture()
  const created = await authority.createWorkstream(workspace.id, { goal: 'Protect decisions' })
  const workstream = created.snapshot.workstreams[0]
  assert.ok(workstream)
  const session = workstream.sessions[0]
  assert.ok(session)

  await authority.applyPiWorkstreamKnowledgeCommand(
    workstream.id,
    {
      type: 'put-record',
      expectedKnowledgeRevision: 0,
      expectedRecordRevision: 0,
      record: {
        id: 'decision-a',
        kind: 'decision',
        status: 'proposed',
        summary: 'Keep the existing contract.',
        evidenceIds: [],
      },
    },
    session.id
  )
  await assert.rejects(
    authority.applyPiWorkstreamKnowledgeCommand(
      workstream.id,
      { type: 'accept-decision', expectedKnowledgeRevision: 1, expectedRecordRevision: 1, recordId: 'decision-a' },
      session.id
    ),
    /user-only/
  )

  const accepted = await authority.applyUserWorkstreamKnowledgeCommand(workstream.id, {
    type: 'accept-decision',
    expectedKnowledgeRevision: 1,
    expectedRecordRevision: 1,
    recordId: 'decision-a',
  })
  assert.equal(accepted.knowledge.records[0]?.kind, 'decision')
  assert.equal(accepted.knowledge.records[0]?.status, 'accepted')
})

test('publishes committed user and Pi Workstream knowledge mutations', async () => {
  const { authority, workspace } = await createFixture()
  const created = await authority.createWorkstream(workspace.id, { goal: 'Publish knowledge changes' })
  const workstream = created.snapshot.workstreams[0]!
  const revisions: number[] = []
  const unsubscribe = authority.subscribeWorkstreamKnowledge((knowledge) => revisions.push(knowledge.knowledgeRevision))

  await authority.applyPiWorkstreamKnowledgeCommand(
    workstream.id,
    {
      type: 'put-record',
      expectedKnowledgeRevision: 0,
      expectedRecordRevision: 0,
      record: {
        id: 'decision-a',
        kind: 'decision',
        status: 'proposed',
        summary: 'Keep the contract.',
        evidenceIds: [],
      },
    },
    created.sessionId
  )
  await authority.applyUserWorkstreamKnowledgeCommand(workstream.id, {
    type: 'accept-decision',
    expectedKnowledgeRevision: 1,
    expectedRecordRevision: 1,
    recordId: 'decision-a',
  })
  unsubscribe()

  assert.deepEqual(revisions, [1, 2])
})

test('rolls back a forged Pi rewrite of an accepted decision', async () => {
  const { authority, storageDirectory, workspace } = await createFixture()
  const created = await authority.createWorkstream(workspace.id, { goal: 'Protect accepted decisions' })
  const workstream = created.snapshot.workstreams[0]!

  await authority.applyPiWorkstreamKnowledgeCommand(
    workstream.id,
    {
      type: 'put-record',
      expectedKnowledgeRevision: 0,
      expectedRecordRevision: 0,
      record: {
        id: 'decision-a',
        kind: 'decision',
        status: 'proposed',
        summary: 'Keep the contract.',
        evidenceIds: [],
      },
    },
    created.sessionId
  )
  await authority.applyUserWorkstreamKnowledgeCommand(workstream.id, {
    type: 'accept-decision',
    expectedKnowledgeRevision: 1,
    expectedRecordRevision: 1,
    recordId: 'decision-a',
  })

  await assert.rejects(
    authority.applyPiWorkstreamKnowledgeCommand(
      workstream.id,
      {
        type: 'put-record',
        expectedKnowledgeRevision: 2,
        expectedRecordRevision: 2,
        record: {
          id: 'decision-a',
          kind: 'decision',
          status: 'proposed',
          summary: 'Replace the accepted direction.',
          evidenceIds: [],
        },
      },
      created.sessionId
    ),
    /rewrite accepted/
  )

  const database = new Database(join(storageDirectory, 'application-state.sqlite'))
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM workstream_record_history').get()?.count, 2)
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM workstream_mutations').get()?.count, 2)
  database.close()
})

test('rejects Pi mutations attributed to a foreign or Default Session', async () => {
  const { authority, workspace } = await createFixture()
  const goal = await authority.createWorkstream(workspace.id, { goal: 'Protect provenance' })
  const quick = await authority.createQuickSession(workspace.id, { repositoryId: workspace.repositories[0]!.id })
  const workstream = goal.snapshot.workstreams[0]!
  const command = {
    type: 'put-record' as const,
    expectedKnowledgeRevision: 0,
    expectedRecordRevision: 0,
    record: { id: 'finding-a', kind: 'finding' as const, summary: 'Unsupported.', repositoryIds: [], evidenceIds: [] },
  }

  await assert.rejects(
    authority.applyPiWorkstreamKnowledgeCommand(workstream.id, command, 'unknown' as SessionId),
    /owning/
  )
  await assert.rejects(authority.applyPiWorkstreamKnowledgeCommand(workstream.id, command, quick.sessionId), /owning/)
})

test('rejects Workstream records that reference a Repository outside their Workspace', async () => {
  const { authority, workspace } = await createFixture()
  const created = await authority.createWorkstream(workspace.id, { goal: 'Keep Repository identity scoped' })
  const workstream = created.snapshot.workstreams[0]!

  await assert.rejects(
    authority.applyPiWorkstreamKnowledgeCommand(
      workstream.id,
      {
        type: 'put-record',
        expectedKnowledgeRevision: 0,
        expectedRecordRevision: 0,
        record: {
          id: 'impact-a',
          kind: 'repository-impact',
          repositoryId: 'foreign-repository',
          classification: 'unaffected',
          summary: 'This Repository is not a member.',
          evidenceIds: [],
        },
      },
      created.sessionId
    ),
    /Repositories in their Workspace/
  )
})

test('persists an explicit Brainstorm Session across restart', async () => {
  const { authority, storageDirectory, workspace } = await createFixture()
  await authority.createWorkstream(workspace.id, { goal: 'Understand current behavior', mode: 'brainstorm' })

  const restarted = await initializeApplicationAuthority(storageDirectory, { sqlite: bunSqlite })
  const snapshot = await restarted.getWorkstreamSnapshot(workspace.id)

  assert.equal(snapshot.workstreams[0]?.sessions[0]?.mode, 'brainstorm')
})

test('keeps Execution Progress Implement-only at the persisted authority boundary', async () => {
  const { authority, workspace } = await createFixture()
  const created = await authority.createWorkstream(workspace.id, {
    goal: 'Keep Brainstorm read-only',
    mode: 'brainstorm',
  })
  const workstream = created.snapshot.workstreams[0]!

  await assert.rejects(
    authority.applyPiWorkstreamKnowledgeCommand(
      workstream.id,
      {
        type: 'put-record',
        expectedKnowledgeRevision: 0,
        expectedRecordRevision: 0,
        record: {
          id: 'progress-a',
          kind: 'execution-progress',
          repositoryIds: [],
          status: 'in-progress',
          summary: 'Started implementation.',
        },
      },
      created.sessionId
    ),
    /Implement-only/
  )
})

test('creates a goal-less Quick Session with direct access to its selected Repository', async () => {
  const { authority, workspace } = await createFixture()
  const repository = workspace.repositories[0]
  assert.ok(repository)

  const created = await authority.createQuickSession(workspace.id, { repositoryId: repository.id })
  const workstream = created.snapshot.workstreams[0]
  const quickSession = workstream?.sessions[0]

  assert.equal(workstream?.goal, undefined)
  assert.equal(quickSession?.mode, 'default')
  assert.deepEqual(quickSession?.repositoryAccess, {
    kind: 'direct',
    repositoryId: repository.id,
    repositoryName: repository.name,
    availability: 'available',
  })
  const resolution = quickSession ? await authority.resolveOwnedSession(quickSession.id) : undefined
  assert.equal(resolution?.directoryPath, repository.directoryPath)
  assert.equal(resolution?.toolAccess, 'full')
  assert.equal(
    resolution ? SessionManager.open(resolution.sessionPath, undefined, resolution.directoryPath).getCwd() : undefined,
    repository.directoryPath
  )
})

test('records only the selected Repository as a Quick Session current checkout', async () => {
  const { authority, storageDirectory, workspace } = await createFixture()
  const secondPath = join(storageDirectory, 'second-repository')
  await exec('git', ['init', secondPath])
  const updated = await authority.addWorkspaceRepositories(workspace.id, [secondPath])
  const second = updated.workspaces[0]?.repositories.find((repository) => repository.directoryPath === secondPath)
  assert.ok(second)

  const created = await authority.createQuickSession(workspace.id, { repositoryId: second.id })

  assert.deepEqual(created.snapshot.workstreams[0]?.repositoryWorkingLocations, [
    {
      repositoryId: second.id,
      repositoryName: second.name,
      kind: 'current-checkout',
      availability: 'available',
      workingPath: second.directoryPath,
    },
  ])
})

test('previews a Quick Session worktree for only the selected Repository', async () => {
  const { authority, storageDirectory, workspace } = await createFixture()
  const secondPath = join(storageDirectory, 'second-repository')
  await exec('git', ['init', secondPath])
  await writeFile(join(secondPath, 'tracked.txt'), 'committed')
  await exec('git', ['-C', secondPath, 'add', 'tracked.txt'])
  await exec('git', [
    '-C',
    secondPath,
    '-c',
    'user.name=Pi Workspace tests',
    '-c',
    'user.email=tests@pi-workspace.invalid',
    'commit',
    '-m',
    'Initial commit',
  ])
  const updated = await authority.addWorkspaceRepositories(workspace.id, [secondPath])
  const second = updated.workspaces[0]?.repositories.find((repository) => repository.directoryPath === secondPath)
  assert.ok(second)

  const preview = await authority.previewWorktreeLocations(workspace.id, second.id)

  assert.equal(preview.repositories.length, 1)
  assert.equal(preview.repositories[0]?.repositoryId, second.id)
})

test('creates a Quick Session in its selected Repository worktree', async () => {
  const { authority, workspace } = await createFixture()
  const repository = workspace.repositories[0]!
  await writeFile(join(repository.directoryPath, 'tracked.txt'), 'committed')
  await exec('git', ['-C', repository.directoryPath, 'add', 'tracked.txt'])
  await exec('git', [
    '-C',
    repository.directoryPath,
    '-c',
    'user.name=Pi Workspace tests',
    '-c',
    'user.email=tests@pi-workspace.invalid',
    'commit',
    '-m',
    'Initial commit',
  ])
  const preview = await authority.previewWorktreeLocations(workspace.id, repository.id)

  const created = await authority.createQuickSession(workspace.id, {
    repositoryId: repository.id,
    workingLocation: 'worktrees',
    workstreamId: preview.workstreamId,
  })
  const workstream = created.snapshot.workstreams[0]!
  const resolution = await authority.resolveOwnedSession(created.sessionId)
  const expectedPath = join(dirname(repository.directoryPath), '.worktrees', worktreeName(workstream.id), repository.id)

  assert.equal(preview.repositories[0]?.workingPath, expectedPath)
  assert.equal(workstream.workingLocation, 'worktrees')
  assert.deepEqual(workstream.repositoryWorkingLocations, [
    {
      repositoryId: repository.id,
      repositoryName: repository.name,
      kind: 'worktree',
      availability: 'available',
      workingPath: expectedPath,
    },
  ])
  assert.equal(resolution?.directoryPath, expectedPath)
  assert.equal(
    resolution ? SessionManager.open(resolution.sessionPath, undefined, resolution.directoryPath).getCwd() : undefined,
    expectedPath
  )
})

test('retries Quick Session creation with the previewed worktree identity', async () => {
  const storageDirectory = await mkdtemp(join(tmpdir(), 'pi-workspace-quick-worktree-retry-'))
  temporaryDirectories.push(storageDirectory)
  const repositoryPath = join(storageDirectory, 'repository')
  await exec('git', ['init', repositoryPath])
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
  const interrupted = await initializeApplicationAuthority(storageDirectory, {
    sqlite: bunSqlite,
    createWorktree: async (proposal) => {
      await createWorktree(proposal)
      throw new Error('simulated crash after Git worktree creation')
    },
  })
  const workspace = (await interrupted.createWorkspace('Workspace', [repositoryPath])).workspaces[0]!
  const repository = workspace.repositories[0]!
  const preview = await interrupted.previewWorktreeLocations(workspace.id, repository.id)
  const options = {
    repositoryId: repository.id,
    workingLocation: 'worktrees' as const,
    workstreamId: preview.workstreamId,
  }

  await assert.rejects(interrupted.createQuickSession(workspace.id, options), /simulated crash/)

  const restarted = await initializeApplicationAuthority(storageDirectory, { sqlite: bunSqlite })
  const created = await restarted.createQuickSession(workspace.id, options)

  assert.equal(
    (await restarted.resolveOwnedSession(created.sessionId))?.directoryPath,
    preview.repositories[0]?.workingPath
  )
})

test('can use the current checkout after Quick Session worktree creation fails', async () => {
  const { authority, workspace } = await createFixture()
  const repository = workspace.repositories[0]!
  await writeFile(join(repository.directoryPath, 'tracked.txt'), 'committed')
  await exec('git', ['-C', repository.directoryPath, 'add', 'tracked.txt'])
  await exec('git', [
    '-C',
    repository.directoryPath,
    '-c',
    'user.name=Pi Workspace tests',
    '-c',
    'user.email=tests@pi-workspace.invalid',
    'commit',
    '-m',
    'Initial commit',
  ])
  const preview = await authority.previewWorktreeLocations(workspace.id, repository.id)
  await mkdir(preview.repositories[0]!.workingPath, { recursive: true })
  await writeFile(join(preview.repositories[0]!.workingPath, 'unexpected.txt'), 'do not overwrite')

  await assert.rejects(
    authority.createQuickSession(workspace.id, {
      repositoryId: repository.id,
      workingLocation: 'worktrees',
      workstreamId: preview.workstreamId,
    }),
    /already exists/
  )

  const created = await authority.createQuickSession(workspace.id, {
    repositoryId: repository.id,
    workingLocation: 'current-checkouts',
    workstreamId: preview.workstreamId,
  })

  assert.equal(created.snapshot.workstreams[0]?.workingLocation, 'current-checkouts')
  assert.equal((await authority.resolveOwnedSession(created.sessionId))?.directoryPath, repository.directoryPath)
})

test('reopens a worktree-backed Quick Session against its recorded path', async () => {
  const { authority, storageDirectory, workspace } = await createFixture()
  const repository = workspace.repositories[0]!
  await writeFile(join(repository.directoryPath, 'tracked.txt'), 'committed')
  await exec('git', ['-C', repository.directoryPath, 'add', 'tracked.txt'])
  await exec('git', [
    '-C',
    repository.directoryPath,
    '-c',
    'user.name=Pi Workspace tests',
    '-c',
    'user.email=tests@pi-workspace.invalid',
    'commit',
    '-m',
    'Initial commit',
  ])
  const preview = await authority.previewWorktreeLocations(workspace.id, repository.id)
  const created = await authority.createQuickSession(workspace.id, {
    repositoryId: repository.id,
    workingLocation: 'worktrees',
    workstreamId: preview.workstreamId,
  })

  const restarted = await initializeApplicationAuthority(storageDirectory, { sqlite: bunSqlite })
  const resolution = await restarted.resolveOwnedSession(created.sessionId)

  assert.equal(resolution?.directoryPath, preview.repositories[0]?.workingPath)
})

test('keeps a worktree-backed Quick Session available after its branch is renamed', async () => {
  const { authority, workspace } = await createFixture()
  const repository = workspace.repositories[0]!
  await writeFile(join(repository.directoryPath, 'tracked.txt'), 'committed')
  await exec('git', ['-C', repository.directoryPath, 'add', 'tracked.txt'])
  await exec('git', [
    '-C',
    repository.directoryPath,
    '-c',
    'user.name=Pi Workspace tests',
    '-c',
    'user.email=tests@pi-workspace.invalid',
    'commit',
    '-m',
    'Initial commit',
  ])
  const preview = await authority.previewWorktreeLocations(workspace.id, repository.id)
  const created = await authority.createQuickSession(workspace.id, {
    repositoryId: repository.id,
    workingLocation: 'worktrees',
    workstreamId: preview.workstreamId,
  })
  const worktreePath = preview.repositories[0]!.workingPath
  await exec('git', ['-C', worktreePath, 'branch', '-m', 'renamed-quick-session-branch'])

  const snapshot = await authority.getWorkstreamSnapshot(workspace.id)

  assert.equal(snapshot.workstreams[0]?.repositoryWorkingLocations[0]?.availability, 'available')
  assert.equal((await authority.resolveOwnedSession(created.sessionId))?.directoryPath, worktreePath)
})

test('makes a Quick Session unavailable when its recorded worktree is missing', async () => {
  const { authority, workspace } = await createFixture()
  const repository = workspace.repositories[0]!
  await writeFile(join(repository.directoryPath, 'tracked.txt'), 'committed')
  await exec('git', ['-C', repository.directoryPath, 'add', 'tracked.txt'])
  await exec('git', [
    '-C',
    repository.directoryPath,
    '-c',
    'user.name=Pi Workspace tests',
    '-c',
    'user.email=tests@pi-workspace.invalid',
    'commit',
    '-m',
    'Initial commit',
  ])
  const preview = await authority.previewWorktreeLocations(workspace.id, repository.id)
  const created = await authority.createQuickSession(workspace.id, {
    repositoryId: repository.id,
    workingLocation: 'worktrees',
    workstreamId: preview.workstreamId,
  })
  await rm(preview.repositories[0]!.workingPath, { recursive: true })

  const snapshot = await authority.getWorkstreamSnapshot(workspace.id)
  const quickSession = snapshot.workstreams[0]?.sessions[0]

  assert.equal(snapshot.workstreams[0]?.repositoryWorkingLocations[0]?.availability, 'unavailable')
  assert.equal(quickSession?.repositoryAccess.kind, 'direct')
  if (quickSession?.repositoryAccess.kind !== 'direct') assert.fail('Expected direct Repository access.')
  assert.equal(quickSession.repositoryAccess.availability, 'unavailable')
  assert.equal(await authority.resolveOwnedSession(created.sessionId), undefined)
})

test('persists Quick Session direct access and full tool policy across restart', async () => {
  const { authority, storageDirectory, workspace } = await createFixture()
  const repository = workspace.repositories[0]
  assert.ok(repository)
  const created = await authority.createQuickSession(workspace.id, { repositoryId: repository.id })

  const restarted = await initializeApplicationAuthority(storageDirectory, { sqlite: bunSqlite })
  const snapshot = await restarted.getWorkstreamSnapshot(workspace.id)
  const quickSession = snapshot.workstreams[0]?.sessions[0]
  assert.ok(quickSession)
  const resolution = await restarted.resolveOwnedSession(created.sessionId)

  assert.equal(quickSession.mode, 'default')
  assert.deepEqual(quickSession.repositoryAccess, {
    kind: 'direct',
    repositoryId: repository.id,
    repositoryName: repository.name,
    availability: 'available',
  })
  assert.equal(resolution?.directoryPath, repository.directoryPath)
  assert.equal(resolution?.canSubmit, true)
  assert.equal(resolution?.toolAccess, 'full')
})

test('derives the current Repository set from Quick access and excludes tombstoned impacts', async () => {
  const { authority, workspace } = await createFixture()
  const repository = workspace.repositories[0]
  assert.ok(repository)
  const quick = await authority.createQuickSession(workspace.id, { repositoryId: repository.id })
  const workstream = quick.snapshot.workstreams[0]
  assert.ok(workstream)

  assert.deepEqual(await authority.getCurrentWorkstreamRepositorySet(workstream.id), [repository.id])

  const goalCreated = await authority.createWorkstream(workspace.id, { goal: 'Track Repository impact' })
  const goalWorkstream = goalCreated.snapshot.workstreams.find((candidate) => candidate.goal)
  assert.ok(goalWorkstream)
  const session = goalWorkstream.sessions[0]
  assert.ok(session)
  const impacted = await authority.applyPiWorkstreamKnowledgeCommand(
    goalWorkstream.id,
    {
      type: 'put-record',
      expectedKnowledgeRevision: 0,
      expectedRecordRevision: 0,
      record: {
        id: 'impact-a',
        kind: 'repository-impact',
        repositoryId: repository.id,
        classification: 'unaffected',
        summary: 'No change expected.',
        evidenceIds: [],
      },
    },
    session.id
  )
  assert.deepEqual(impacted.knowledge.currentRepositoryIds, [repository.id])

  const tombstoned = await authority.applyPiWorkstreamKnowledgeCommand(
    goalWorkstream.id,
    {
      type: 'tombstone-record',
      expectedKnowledgeRevision: impacted.knowledge.knowledgeRevision,
      expectedRecordRevision: 1,
      recordId: 'impact-a',
    },
    session.id
  )
  assert.deepEqual(tombstoned.knowledge.currentRepositoryIds, [])
})

test('does not block membership removal for automatic managed Session access alone', async () => {
  const { authority, storageDirectory, workspace } = await createFixture()
  const first = workspace.repositories[0]
  assert.ok(first)
  const secondPath = join(storageDirectory, 'second-repository')
  await exec('git', ['init', secondPath])
  const withSecond = await authority.addWorkspaceRepositories(workspace.id, [secondPath])
  const second = withSecond.workspaces[0]?.repositories.find((repository) => repository.id !== first.id)
  assert.ok(second)
  const created = await authority.createWorkstream(workspace.id, { goal: 'Use automatic managed access' })

  const updated = await authority.removeWorkspaceRepository(workspace.id, second.membershipId)
  const workstream = (await authority.getWorkstreamSnapshot(workspace.id)).workstreams[0]
  const resolution = await authority.resolveOwnedSession(created.sessionId)

  assert.equal(
    updated.workspaces[0]?.repositories.some((repository) => repository.id === second.id),
    false
  )
  assert.equal(
    workstream?.repositoryWorkingLocations.some((location) => location.repositoryId === second.id),
    false
  )
  assert.equal(
    resolution?.managedPolicy?.repositories.some((repository) => repository.id === second.id),
    false
  )
})

test('rejects removing a Repository used by an active Quick Session', async () => {
  const { authority, storageDirectory, workspace } = await createFixture()
  const first = workspace.repositories[0]
  assert.ok(first)
  const secondPath = join(storageDirectory, 'second-repository')
  await exec('git', ['init', secondPath])
  const withSecond = await authority.addWorkspaceRepositories(workspace.id, [secondPath])
  const second = withSecond.workspaces[0]?.repositories.find((candidate) => candidate.id !== first.id)
  assert.ok(second)
  const quick = await authority.createQuickSession(workspace.id, { repositoryId: first.id })

  await assert.rejects(
    authority.removeWorkspaceRepository(workspace.id, first.membershipId),
    /used by an active Workstream/
  )
  assert.deepEqual(await authority.getCurrentWorkstreamRepositorySet(quick.snapshot.workstreams[0]!.id), [first.id])
})

test('rejects removing a Repository with an active Session worktree', async () => {
  const { authority, storageDirectory, workspace } = await createFixture()
  const first = workspace.repositories[0]!
  const secondPath = join(storageDirectory, 'second-repository')
  await exec('git', ['init', secondPath])

  for (const repositoryPath of [first.directoryPath, secondPath]) {
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
  }

  await authority.addWorkspaceRepositories(workspace.id, [secondPath])
  const created = await authority.createWorkstream(workspace.id, { goal: 'Keep worktrees attached' })
  await authority.prepareSessionRepository(created.sessionId, first.id)

  await assert.rejects(authority.removeWorkspaceRepository(workspace.id, first.membershipId), /active Workstream/)
})

test('allows membership removal after an affected Workstream is archived', async () => {
  const { authority, storageDirectory, workspace } = await createFixture()
  const first = workspace.repositories[0]!
  const secondPath = join(storageDirectory, 'second-repository')
  await exec('git', ['init', secondPath])
  await authority.addWorkspaceRepositories(workspace.id, [secondPath])
  const created = await authority.createWorkstream(workspace.id, { goal: 'Preserve archived context' })
  const workstream = created.snapshot.workstreams[0]!

  await authority.applyPiWorkstreamKnowledgeCommand(
    workstream.id,
    {
      type: 'put-record',
      expectedKnowledgeRevision: 0,
      expectedRecordRevision: 0,
      record: {
        id: 'impact-a',
        kind: 'repository-impact',
        repositoryId: first.id,
        classification: 'unaffected',
        summary: 'The archived specification retains this Repository.',
        evidenceIds: [],
      },
    },
    created.sessionId
  )
  await assert.rejects(authority.removeWorkspaceRepository(workspace.id, first.membershipId), /active Workstream/)

  await authority.setWorkstreamLifecycle(workstream.id, 'archived')
  const updated = await authority.removeWorkspaceRepository(workspace.id, first.membershipId)
  await authority.setWorkstreamLifecycle(workstream.id, 'active')
  const reopened = (await authority.getWorkstreamSnapshot(workspace.id)).workstreams[0]
  const resolution = await authority.resolveOwnedSession(created.sessionId)

  assert.equal(
    updated.workspaces[0]?.repositories.some((repository) => repository.id === first.id),
    false
  )
  assert.equal(
    reopened?.repositoryWorkingLocations.some((location) => location.repositoryId === first.id),
    false
  )
  assert.equal(
    resolution?.managedPolicy?.repositories.some((repository) => repository.id === first.id),
    false
  )
  await assert.rejects(authority.resolveWorkstreamWorkingLocation(workstream.id, first.id), /unavailable/)
})

test('rejects Quick Session creation for a Repository outside the Workspace', async () => {
  const { authority, workspace } = await createFixture()

  await assert.rejects(
    authority.createQuickSession(workspace.id, { repositoryId: 'unknown-repository' }),
    /current Workspace/
  )
})

test('rejects Quick Session creation when its Repository is unavailable', async () => {
  const { authority, workspace } = await createFixture()
  const repository = workspace.repositories[0]
  assert.ok(repository)
  await rm(repository.directoryPath, { recursive: true })

  await assert.rejects(authority.createQuickSession(workspace.id, { repositoryId: repository.id }), /unavailable/)
})

test('keeps Quick Session history available when its direct Repository checkout disappears', async () => {
  const { authority, workspace } = await createFixture()
  const repository = workspace.repositories[0]
  assert.ok(repository)
  const created = await authority.createQuickSession(workspace.id, { repositoryId: repository.id })
  await rm(repository.directoryPath, { recursive: true })

  const snapshot = await authority.getWorkstreamSnapshot(workspace.id)
  const quickSession = snapshot.workstreams[0]?.sessions[0]

  assert.equal(quickSession?.availability, 'available')
  assert.equal(quickSession?.repositoryAccess.kind, 'direct')
  if (quickSession?.repositoryAccess.kind !== 'direct') assert.fail('Expected direct Repository access.')
  assert.equal(quickSession.repositoryAccess.availability, 'unavailable')
  assert.equal(await authority.resolveOwnedSession(created.sessionId), undefined)
})

test('represents Quick Session history loss independently from direct Repository access', async () => {
  const { authority, workspace } = await createFixture()
  const repository = workspace.repositories[0]
  assert.ok(repository)
  const created = await authority.createQuickSession(workspace.id, { repositoryId: repository.id })
  const resolution = await authority.resolveOwnedSession(created.sessionId)
  assert.ok(resolution)
  await rm(resolution.sessionPath)

  const snapshot = await authority.getWorkstreamSnapshot(workspace.id)
  const quickSession = snapshot.workstreams[0]?.sessions[0]

  assert.equal(quickSession?.availability, 'unavailable')
  assert.equal(quickSession?.repositoryAccess.kind, 'direct')
  if (quickSession?.repositoryAccess.kind !== 'direct') assert.fail('Expected direct Repository access.')
  assert.equal(quickSession.repositoryAccess.availability, 'available')
})

test('represents both Quick Session history and direct Repository checkout loss', async () => {
  const { authority, workspace } = await createFixture()
  const repository = workspace.repositories[0]
  assert.ok(repository)
  const created = await authority.createQuickSession(workspace.id, { repositoryId: repository.id })
  const resolution = await authority.resolveOwnedSession(created.sessionId)
  assert.ok(resolution)
  await rm(resolution.sessionPath)
  await rm(repository.directoryPath, { recursive: true })

  const snapshot = await authority.getWorkstreamSnapshot(workspace.id)
  const quickSession = snapshot.workstreams[0]?.sessions[0]

  assert.equal(quickSession?.availability, 'unavailable')
  assert.equal(quickSession?.repositoryAccess.kind, 'direct')
  if (quickSession?.repositoryAccess.kind !== 'direct') assert.fail('Expected direct Repository access.')
  assert.equal(quickSession.repositoryAccess.availability, 'unavailable')
  assert.equal(await authority.resolveOwnedSession(created.sessionId), undefined)
})

test('keeps Quick Session mode and direct Repository access immutable when renamed', async () => {
  const { authority, workspace } = await createFixture()
  const repository = workspace.repositories[0]
  assert.ok(repository)
  const created = await authority.createQuickSession(workspace.id, { repositoryId: repository.id })

  const renamed = await authority.renameWorkstreamSession(created.sessionId, 'Investigate the checkout')
  const quickWorkstream = renamed.workstreams[0]
  const quickSession = quickWorkstream?.sessions[0]

  assert.equal(quickWorkstream?.goal, undefined)
  assert.equal(quickSession?.mode, 'default')
  assert.deepEqual(quickSession?.repositoryAccess, {
    kind: 'direct',
    repositoryId: repository.id,
    repositoryName: repository.name,
    availability: 'available',
  })
})

test('does not add managed Sessions to a goal-less Quick Workstream', async () => {
  const { authority, workspace } = await createFixture()
  const repository = workspace.repositories[0]
  assert.ok(repository)
  const created = await authority.createQuickSession(workspace.id, { repositoryId: repository.id })
  const quickWorkstream = created.snapshot.workstreams[0]
  assert.ok(quickWorkstream)

  await assert.rejects(authority.createWorkstreamSession(quickWorkstream.id, { mode: 'implement' }), /Workstream goal/)
})

test('loads owned history after restart from the expected JSONL without Repository discovery', async () => {
  const { authority, storageDirectory, workspace } = await createFixture()
  const created = await authority.createWorkstream(workspace.id, { goal: 'Retain this history' })
  const ownedSession = created.snapshot.workstreams[0]?.sessions[0]
  assert.ok(ownedSession)
  const initialResolution = await authority.resolveOwnedSession(ownedSession.id)
  assert.ok(initialResolution)
  const manager = SessionManager.open(initialResolution.sessionPath, undefined, initialResolution.directoryPath)
  manager.appendMessage({ role: 'user', content: 'Persist this message', timestamp: Date.now() })
  let repositoryInspectionCount = 0

  const restarted = await initializeApplicationAuthority(storageDirectory, {
    sqlite: bunSqlite,
    inspectRepository: async () => {
      repositoryInspectionCount += 1
      throw new Error('Owned managed Session history must not inspect Repositories.')
    },
  })
  const restartedResolution = await restarted.resolveOwnedSession(ownedSession.id)
  assert.ok(restartedResolution)
  const reopened = SessionManager.open(restartedResolution.sessionPath, undefined, restartedResolution.directoryPath)

  assert.equal(repositoryInspectionCount, 0)
  assert.equal(reopened.getBranch()[0]?.type, 'message')
  assert.equal(reopened.getCwd(), restartedResolution.directoryPath)
})

test('restores a managed Session with every Workspace Repository and normal built-ins', async () => {
  const { authority, storageDirectory, workspace } = await createFixture()
  const created = await authority.createWorkstream(workspace.id, { goal: 'Wait for scope' })
  const restarted = await initializeApplicationAuthority(storageDirectory, { sqlite: bunSqlite })
  let runtimeToolAccess: 'none' | 'read-only' | 'full' | undefined
  const registry = createPiSessionRuntimeRegistry({
    findSession: (id) => restarted.resolveOwnedSession(id),
    createSession: async (location) => {
      runtimeToolAccess = location.toolAccess

      return {
        isStreaming: false,
        async prompt() {},
        subscribe: () => () => {},
        dispose() {},
      }
    },
  })

  await registry.getTranscript(created.sessionId)

  const resolution = await restarted.resolveOwnedSession(created.sessionId)

  assert.equal(runtimeToolAccess, 'full')
  assert.equal(resolution?.canSubmit, true)
  assert.deepEqual(
    resolution?.managedPolicy?.repositories.map((repository) => ({
      id: repository.id,
      availability: repository.availability,
      workingPath: repository.availability === 'available' ? repository.workingPath : undefined,
    })),
    workspace.repositories.map(({ id, directoryPath }) => ({
      id,
      availability: 'available',
      workingPath: directoryPath,
    }))
  )
})

test('gives managed Sessions immediate access to Repositories added after Workstream creation', async () => {
  const { authority, storageDirectory, workspace } = await createFixture()
  const created = await authority.createWorkstream(workspace.id, { goal: 'Use every current Repository' })
  const secondPath = join(storageDirectory, 'second-repository')
  await exec('git', ['init', secondPath])
  const updated = await authority.addWorkspaceRepositories(workspace.id, [secondPath])
  const second = updated.workspaces[0]?.repositories.find((repository) => repository.directoryPath === secondPath)
  assert.ok(second)

  const resolution = await authority.resolveOwnedSession(created.sessionId)
  const runtimeRepository = resolution?.managedPolicy?.repositories.find((repository) => repository.id === second.id)
  const workstream = (await authority.getWorkstreamSnapshot(workspace.id)).workstreams[0]
  const snapshotLocation = workstream?.repositoryWorkingLocations.find(
    (location) => location.repositoryId === second.id
  )

  assert.equal(runtimeRepository?.availability, 'available')
  if (runtimeRepository?.availability === 'available') assert.equal(runtimeRepository.workingPath, secondPath)
  assert.deepEqual(snapshotLocation, {
    repositoryId: second.id,
    repositoryName: second.name,
    kind: 'current-checkout',
    availability: 'available',
    workingPath: secondPath,
  })
  assert.equal(await authority.resolveWorkstreamWorkingLocation(workstream!.id, second.id), secondPath)
})

test('resolves managed runtime Repository relationships to Repository ids', async () => {
  const storageDirectory = await mkdtemp(join(tmpdir(), 'pi-workspace-workstreams-'))
  temporaryDirectories.push(storageDirectory)
  const firstRepositoryPath = join(storageDirectory, 'first-repository')
  const secondRepositoryPath = join(storageDirectory, 'second-repository')
  await Promise.all([exec('git', ['init', firstRepositoryPath]), exec('git', ['init', secondRepositoryPath])])
  const authority = await initializeApplicationAuthority(storageDirectory, { sqlite: bunSqlite })
  const snapshot = await authority.createWorkspace('Workspace', [firstRepositoryPath, secondRepositoryPath])
  const workspace = snapshot.workspaces[0]
  assert.ok(workspace)
  const [firstRepository, secondRepository] = workspace.repositories
  assert.ok(firstRepository)
  assert.ok(secondRepository)
  await authority.updateWorkspaceMembership(workspace.id, firstRepository.membershipId, {
    role: '',
    relationships: [secondRepository.membershipId],
    validationCommands: [],
  })
  const created = await authority.createWorkstream(workspace.id, { goal: 'Understand Repository relationships' })

  const resolution = await authority.resolveOwnedSession(created.sessionId)

  assert.deepEqual(resolution?.managedPolicy?.repositories[0]?.relationships, [secondRepository.id])
})

test('does not invalidate a managed runtime policy when only a Session title changes', async () => {
  const { authority, workspace } = await createFixture()
  const created = await authority.createWorkstream(workspace.id, { goal: 'Keep runtime policy focused' })
  const before = await authority.resolveOwnedSession(created.sessionId)

  await authority.renameWorkstreamSession(created.sessionId, 'A clearer title')

  const after = await authority.resolveOwnedSession(created.sessionId)

  assert.equal(after?.runtimeKey, before?.runtimeKey)
})

test('does not invalidate a managed runtime policy when its Session description changes', async () => {
  const { authority, workspace } = await createFixture()
  const created = await authority.createWorkstream(workspace.id, { goal: 'Keep runtime policy focused' })
  const before = await authority.resolveOwnedSession(created.sessionId)

  await authority.setSessionDescription(created.sessionId, 'Keeping the Session summary current.')

  const after = await authority.resolveOwnedSession(created.sessionId)

  assert.equal(after?.runtimeKey, before?.runtimeKey)
})

test('keeps an active managed runtime policy while loading another Workspace', async () => {
  const { authority, storageDirectory, workspace } = await createFixture()
  const secondRepositoryPath = join(storageDirectory, 'second-repository')
  await exec('git', ['init', secondRepositoryPath])
  const secondWorkspace = (await authority.createWorkspace('Second Workspace', [secondRepositoryPath])).workspaces.find(
    (candidate) => candidate.id !== workspace.id
  )
  assert.ok(secondWorkspace)
  const created = await authority.createWorkstream(workspace.id, { goal: 'Keep working while navigating' })

  assert.equal(await authority.acquireSessionRunLease(created.sessionId), true)
  const before = await authority.resolveOwnedSession(created.sessionId)
  await authority.getWorkstreamSnapshot(secondWorkspace.id)
  await authority.getWorkstreamSnapshot(workspace.id)
  const after = await authority.resolveOwnedSession(created.sessionId)

  assert.deepEqual(after?.managedPolicy, before?.managedPolicy)
  assert.equal(after?.runtimeKey, before?.runtimeKey)
})

test('invalidates a managed runtime policy when Workspace metadata changes', async () => {
  const { authority, workspace } = await createFixture()
  const created = await authority.createWorkstream(workspace.id, { goal: 'Observe Workspace metadata' })
  const before = await authority.resolveOwnedSession(created.sessionId)
  const membership = workspace.repositories[0]!

  await authority.updateWorkspaceMembership(workspace.id, membership.membershipId, {
    role: 'Primary application',
    relationships: [],
    validationCommands: [],
  })

  const after = await authority.resolveOwnedSession(created.sessionId)

  assert.notEqual(after?.managedPolicy?.resourcePolicyRevision, before?.managedPolicy?.resourcePolicyRevision)
  assert.notEqual(after?.runtimeKey, before?.runtimeKey)
  assert.equal(after?.managedPolicy?.repositories[0]?.role, 'Primary application')
})

test('invalidates managed runtime policy when a Workspace Repository becomes unavailable', async () => {
  let repositoryAvailable = true
  const { authority, workspace } = await createFixture(undefined, async (directoryPath) => {
    if (!repositoryAvailable) throw new Error('The Repository is unavailable.')

    return inspectGitRepository(directoryPath)
  })
  const created = await authority.createWorkstream(workspace.id, { goal: 'Track Repository availability' })
  const before = await authority.resolveOwnedSession(created.sessionId)
  assert.ok(before?.managedPolicy)

  repositoryAvailable = false
  const snapshot = await authority.getWorkstreamSnapshot(workspace.id)
  const after = await authority.resolveOwnedSession(created.sessionId)

  assert.equal(snapshot.workstreams[0]?.sessions[0]?.availability, 'available')
  assert.equal(after?.managedPolicy?.repositories[0]?.availability, 'unavailable')
  assert.equal('workingPath' in after!.managedPolicy!.repositories[0]!, false)
  assert.notEqual(after?.managedPolicy?.resourcePolicyRevision, before.managedPolicy.resourcePolicyRevision)
  assert.notEqual(after?.runtimeKey, before.runtimeKey)
})

test('accepts a managed submission after restart', async () => {
  const { authority, storageDirectory, workspace } = await createFixture()
  const created = await authority.createWorkstream(workspace.id, { goal: 'Wait for scope' })
  const restarted = await initializeApplicationAuthority(storageDirectory, { sqlite: bunSqlite })
  let runtimeCreated = false
  const registry = createPiSessionRuntimeRegistry({
    findSession: (id) => restarted.resolveOwnedSession(id),
    canSubmit: async (id) => (await restarted.resolveOwnedSession(id))?.canSubmit ?? false,
    createSession: async () => {
      runtimeCreated = true
      return {
        isStreaming: false,
        async prompt(_text, options) {
          options.preflightResult(true)
        },
        subscribe: () => () => {},
        dispose() {},
      }
    },
  })

  const result = await registry.submit({
    sessionId: created.sessionId,
    text: 'Bypass the renderer',
    delivery: 'steer',
  })

  assert.deepEqual(result, { status: 'accepted', delivery: 'prompt' })
  assert.equal(runtimeCreated, true)
})

test('creates another Session without sharing mode or transcript identity', async () => {
  const { authority, workspace } = await createFixture()
  const created = await authority.createWorkstream(workspace.id, { goal: 'Ship the change', mode: 'brainstorm' })
  const workstream = created.snapshot.workstreams[0]
  assert.ok(workstream)

  const updated = await authority.createWorkstreamSession(workstream.id, { mode: 'implement', title: 'Build it' })
  const sessions = updated.snapshot.workstreams[0]?.sessions ?? []

  assert.equal(sessions.length, 2)
  assert.deepEqual(
    sessions.map((session) => session.mode),
    ['brainstorm', 'implement']
  )
  assert.equal(new Set(sessions.map((session) => session.id)).size, 2)
  assert.deepEqual(
    sessions.map((session) => session.repositoryAccess),
    [{ kind: 'managed' }, { kind: 'managed' }]
  )
})

test('archives and restores a Workstream without changing its identity', async () => {
  const { authority, workspace } = await createFixture()
  const created = await authority.createWorkstream(workspace.id, { goal: 'Ship the change' })
  const workstream = created.snapshot.workstreams[0]
  assert.ok(workstream)

  const archived = await authority.setWorkstreamLifecycle(workstream.id, 'archived')
  const restored = await authority.setWorkstreamLifecycle(workstream.id, 'active')

  assert.deepEqual([archived.workstreams[0]?.id, archived.workstreams[0]?.lifecycle], [workstream.id, 'archived'])
  assert.deepEqual([restored.workstreams[0]?.id, restored.workstreams[0]?.lifecycle], [workstream.id, 'active'])
})

test('repeating a Workstream lifecycle transition is idempotent', async () => {
  const { authority, workspace } = await createFixture()
  const created = await authority.createWorkstream(workspace.id, { goal: 'Ship once' })
  const workstream = created.snapshot.workstreams[0]
  assert.ok(workstream)

  const archived = await authority.setWorkstreamLifecycle(workstream.id, 'archived')
  const repeated = await authority.setWorkstreamLifecycle(workstream.id, 'archived')

  assert.equal(repeated.revision, archived.revision)
  assert.equal(repeated.workstreams[0]?.lifecycle, 'archived')
})

test('reopens an archived goal-based Workstream after restart with its Sessions and shared knowledge', async () => {
  const { authority, storageDirectory, workspace } = await createFixture()
  const created = await authority.createWorkstream(workspace.id, { goal: 'Keep the complete Workstream' })
  const workstream = created.snapshot.workstreams[0]
  assert.ok(workstream)

  const mutation = await authority.applyPiWorkstreamKnowledgeCommand(
    workstream.id,
    {
      type: 'put-record',
      expectedKnowledgeRevision: 0,
      expectedRecordRevision: 0,
      record: {
        id: 'finding-a',
        kind: 'finding',
        summary: 'The shared knowledge survives archival.',
        repositoryIds: [],
        evidenceIds: [],
      },
    },
    created.sessionId
  )
  await authority.setWorkstreamLifecycle(workstream.id, 'archived')

  const restarted = await initializeApplicationAuthority(storageDirectory, { sqlite: bunSqlite })
  const archived = (await restarted.getWorkstreamSnapshot(workspace.id)).workstreams[0]
  const sharedKnowledge = await restarted.getWorkstreamKnowledge(workstream.id)
  assert.ok(archived)

  assert.equal(archived.id, workstream.id)
  assert.deepEqual(
    archived.sessions.map((session) => session.id),
    workstream.sessions.map((session) => session.id)
  )
  assert.deepEqual(archived.repositoryWorkingLocations, workstream.repositoryWorkingLocations)
  assert.deepEqual(sharedKnowledge.records, mutation.knowledge.records)
  assert.equal((await restarted.setWorkstreamLifecycle(workstream.id, 'active')).workstreams[0]?.id, workstream.id)
})

test('reopens an archived Quick Workstream after restart with its direct Session ownership', async () => {
  const { authority, storageDirectory, workspace } = await createFixture()
  const repository = workspace.repositories[0]
  assert.ok(repository)
  const created = await authority.createQuickSession(workspace.id, { repositoryId: repository.id })
  const workstream = created.snapshot.workstreams[0]
  assert.ok(workstream)

  await authority.setWorkstreamLifecycle(workstream.id, 'archived')
  const restarted = await initializeApplicationAuthority(storageDirectory, { sqlite: bunSqlite })
  const archived = (await restarted.getWorkstreamSnapshot(workspace.id)).workstreams[0]

  assert.equal(archived?.id, workstream.id)
  assert.equal(archived?.sessions[0]?.id, created.sessionId)
  assert.deepEqual(archived?.sessions[0]?.repositoryAccess, workstream.sessions[0]?.repositoryAccess)
})

test('renaming a Session cannot change its permanent owner or mode', async () => {
  const { authority, workspace } = await createFixture()
  const created = await authority.createWorkstream(workspace.id, { goal: 'Understand the change', mode: 'brainstorm' })
  const before = created.snapshot.workstreams[0]?.sessions[0]
  assert.ok(before)

  const renamed = await authority.renameWorkstreamSession(before.id, 'Map the contracts')
  const after = renamed.workstreams[0]?.sessions[0]

  assert.equal(after?.workstreamId, before.workstreamId)
  assert.equal(after?.mode, before.mode)
})

test('persists an agent-authored Session description across restart', async () => {
  const { authority, storageDirectory, workspace } = await createFixture()
  const created = await authority.createQuickSession(workspace.id, { repositoryId: workspace.repositories[0]!.id })

  const updated = await authority.setSessionDescription(
    created.sessionId,
    '  Investigating sidebar Session summaries.\nKeeping the experiment focused.  '
  )
  const restarted = await initializeApplicationAuthority(storageDirectory, { sqlite: bunSqlite })
  const restored = await restarted.getWorkstreamSnapshot(workspace.id)

  assert.equal(
    updated.workstreams[0]?.sessions[0]?.description,
    'Investigating sidebar Session summaries. Keeping the experiment focused.'
  )
  assert.equal(restored.workstreams[0]?.sessions[0]?.description, updated.workstreams[0]?.sessions[0]?.description)
})

test('allows concurrent Session Agent Runs in isolated Session worktrees', async () => {
  const { authority, workspace } = await createFixture()
  const repository = workspace.repositories[0]!
  await writeFile(join(repository.directoryPath, 'tracked.txt'), 'committed')
  await exec('git', ['-C', repository.directoryPath, 'add', 'tracked.txt'])
  await exec('git', [
    '-C',
    repository.directoryPath,
    '-c',
    'user.name=Pi Workspace tests',
    '-c',
    'user.email=tests@pi-workspace.invalid',
    'commit',
    '-m',
    'Initial commit',
  ])

  const created = await authority.createWorkstream(workspace.id, { goal: 'Coordinate the work' })
  const workstream = created.snapshot.workstreams[0]!
  const second = await authority.createWorkstreamSession(workstream.id, { mode: 'implement' })
  await authority.prepareSessionRepository(created.sessionId, repository.id)
  await authority.prepareSessionRepository(second.sessionId, repository.id)

  assert.equal(await authority.acquireSessionRunLease(created.sessionId), true)
  assert.equal(await authority.acquireSessionRunLease(second.sessionId), true)

  await authority.settleSessionRunLease(created.sessionId)
  assert.equal(await authority.acquireSessionRunLease(created.sessionId), true)

  await authority.settleSessionRunLease(created.sessionId)
  assert.equal(await authority.acquireSessionRunLease(second.sessionId), false)

  await authority.settleSessionRunLease(second.sessionId)
  assert.equal(await authority.acquireSessionRunLease(second.sessionId), true)
})

test('blocks concurrent Agent Runs that share a Repository working path', async () => {
  const { authority, workspace } = await createFixture()
  const repository = workspace.repositories[0]!
  const first = await authority.createQuickSession(workspace.id, { repositoryId: repository.id })
  const second = await authority.createQuickSession(workspace.id, { repositoryId: repository.id })

  assert.equal(await authority.acquireSessionRunLease(first.sessionId), true)
  assert.equal(await authority.acquireSessionRunLease(second.sessionId), false)

  await authority.settleSessionRunLease(first.sessionId)
})

test('migrates prior application state to Session work locations', async () => {
  const { authority, storageDirectory, workspace } = await createFixture()
  const created = await authority.createWorkstream(workspace.id, { goal: 'Migrate Session locations' })
  const database = new Database(join(storageDirectory, 'application-state.sqlite'))
  database.exec('ALTER TABLE session_run_leases RENAME TO workstream_run_leases')
  database.exec('DROP TABLE workstream_run_leases')
  database.exec(
    'CREATE TABLE workstream_run_leases (workstream_id TEXT PRIMARY KEY REFERENCES workstreams(id), lease_id TEXT NOT NULL UNIQUE, session_id TEXT NOT NULL REFERENCES sessions(id), purpose TEXT NOT NULL, acquired_at INTEGER NOT NULL)'
  )
  database.exec('DROP TABLE session_repository_locations')
  database
    .prepare(
      `INSERT INTO workstream_run_leases (workstream_id, lease_id, session_id, purpose, acquired_at)
       SELECT workstream_id, ?, id, 'agent-run', ? FROM sessions WHERE id = ?`
    )
    .run('interrupted-agent-run', Date.now(), created.sessionId)
  database.prepare("UPDATE metadata SET value = '3' WHERE key = 'schema_version'").run()
  database.close()

  const restarted = await initializeApplicationAuthority(storageDirectory, { sqlite: bunSqlite })

  assert.equal(restarted.startup.status, 'ready')
  assert.equal((await restarted.resolveOwnedSession(created.sessionId))?.canSubmit, true)
  assert.equal(await restarted.acquireSessionRunLease(created.sessionId), true)

  await restarted.settleSessionRunLease(created.sessionId)
})

test('migrates version 5 application state to persisted Session descriptions', async () => {
  const { authority, storageDirectory, workspace } = await createFixture()
  const created = await authority.createQuickSession(workspace.id, { repositoryId: workspace.repositories[0]!.id })
  const database = new Database(join(storageDirectory, 'application-state.sqlite'))
  database.exec('ALTER TABLE sessions DROP COLUMN description')
  database.prepare("UPDATE metadata SET value = '5' WHERE key = 'schema_version'").run()
  database.close()

  const restarted = await initializeApplicationAuthority(storageDirectory, { sqlite: bunSqlite })
  const updated = await restarted.setSessionDescription(created.sessionId, 'Summarizing the migrated Session.')

  assert.equal(restarted.startup.status, 'ready')
  assert.equal(updated.workstreams[0]?.sessions[0]?.description, 'Summarizing the migrated Session.')
})

test('releases an interrupted ordinary Agent Run lease during startup', async () => {
  const { authority, storageDirectory, workspace } = await createFixture()
  const created = await authority.createWorkstream(workspace.id, { goal: 'Resume after restart' })

  assert.equal(await authority.acquireSessionRunLease(created.sessionId), true)

  const restarted = await initializeApplicationAuthority(storageDirectory, { sqlite: bunSqlite })

  assert.equal(await restarted.acquireSessionRunLease(created.sessionId), true)
})

test('releases an interrupted Session context compaction lease during startup', async () => {
  const { authority, storageDirectory, workspace } = await createFixture()
  const created = await authority.createWorkstream(workspace.id, { goal: 'Resume after interrupted compaction' })

  assert.equal(await authority.acquireSessionCompactionLease(created.sessionId), true)

  const restarted = await initializeApplicationAuthority(storageDirectory, { sqlite: bunSqlite })

  assert.equal(await restarted.acquireSessionCompactionLease(created.sessionId), true)
  await restarted.settleSessionCompactionLease(created.sessionId)
})

test('withholds submission capability from archived Sessions', async () => {
  const { authority, workspace } = await createFixture()
  const created = await authority.createWorkstream(workspace.id, { goal: 'Stop while archived' })
  const workstream = created.snapshot.workstreams[0]
  assert.ok(workstream)

  await authority.setWorkstreamLifecycle(workstream.id, 'archived')
  const resolution = await authority.resolveOwnedSession(created.sessionId)

  assert.equal(resolution?.canSubmit, false)
  assert.equal(resolution?.toolAccess, 'none')
  assert.equal(await authority.acquireSessionRunLease(created.sessionId), false)
})

test('rejects archival while Session context compaction is active', async () => {
  const { authority, workspace } = await createFixture()
  const created = await authority.createWorkstream(workspace.id, { goal: 'Stay active while compacting' })
  const workstream = created.snapshot.workstreams[0]!

  assert.equal(await authority.acquireSessionCompactionLease(created.sessionId), true)
  await assert.rejects(authority.setWorkstreamLifecycle(workstream.id, 'archived'), /only while every Session is idle/)
  await authority.settleSessionCompactionLease(created.sessionId)

  const archived = await authority.setWorkstreamLifecycle(workstream.id, 'archived')
  assert.equal(archived.workstreams[0]?.lifecycle, 'archived')
})

test('rejects archival while a Workstream Agent Run is active', async () => {
  const { authority, workspace } = await createFixture()
  const created = await authority.createWorkstream(workspace.id, { goal: 'Stay active while running' })
  const workstream = created.snapshot.workstreams[0]!

  assert.equal(await authority.acquireSessionRunLease(created.sessionId), true)
  await assert.rejects(authority.setWorkstreamLifecycle(workstream.id, 'archived'), /only while every Session is idle/)
  await authority.settleSessionRunLease(created.sessionId)

  const archived = await authority.setWorkstreamLifecycle(workstream.id, 'archived')
  assert.equal(archived.workstreams[0]?.lifecycle, 'archived')
})

test('keeps a malformed Workstream visible and disables only that Workstream', async () => {
  const { authority, storageDirectory, workspace } = await createFixture()
  const malformed = await authority.createWorkstream(workspace.id, { goal: 'Keep knowledge trustworthy' })
  const healthy = await authority.createWorkstream(workspace.id, { goal: 'Keep working normally' })
  const database = new Database(join(storageDirectory, 'application-state.sqlite'))
  database
    .prepare("UPDATE workstreams SET lifecycle = 'unknown' WHERE id = ?")
    .run(malformed.snapshot.workstreams[0]!.id)
  database.close()

  const snapshot = await authority.getWorkstreamSnapshot(workspace.id)

  assert.equal(snapshot.workstreams.length, 2)
  assert.match(snapshot.workstreams[0]?.unavailability ?? '', /persisted Workstream lifecycle is malformed/)
  assert.equal(snapshot.workstreams[0]?.sessions.length, 0)
  assert.equal(snapshot.workstreams[1]?.id, healthy.snapshot.workstreams[1]?.id)
  assert.equal(snapshot.workstreams[1]?.unavailability, undefined)
})

test('rejects lifecycle mutations for an unavailable Workstream', async () => {
  const { authority, storageDirectory, workspace } = await createFixture()
  const created = await authority.createWorkstream(workspace.id, { goal: 'Keep knowledge trustworthy' })
  const workstream = created.snapshot.workstreams[0]
  assert.ok(workstream)
  const database = new Database(join(storageDirectory, 'application-state.sqlite'))
  database.prepare("UPDATE workstreams SET lifecycle = 'unknown' WHERE id = ?").run(workstream.id)
  database.close()

  await assert.rejects(authority.setWorkstreamLifecycle(workstream.id, 'active'), /lifecycle is malformed/)
})

test('keeps a malformed recorded working location bounded to its Workstream', async () => {
  const { authority, storageDirectory, workspace } = await createFixture()
  const malformed = await authority.createWorkstream(workspace.id, { goal: 'Keep locations trustworthy' })
  const healthy = await authority.createWorkstream(workspace.id, { goal: 'Keep working normally' })
  const malformedId = malformed.snapshot.workstreams[0]?.id
  assert.ok(malformedId)
  const database = new Database(join(storageDirectory, 'application-state.sqlite'))
  database.prepare("UPDATE workstreams SET working_location = 'worktrees' WHERE id = ?").run(malformedId)
  database
    .prepare(
      `INSERT INTO workstream_repository_locations
        (workstream_id, repository_id, kind, working_path, availability)
       SELECT ?, id, 'unknown', directory_path, 'available' FROM repositories LIMIT 1`
    )
    .run(malformedId)
  database.close()

  const snapshot = await authority.getWorkstreamSnapshot(workspace.id)

  assert.match(snapshot.workstreams[0]?.unavailability ?? '', /working location is malformed/)
  assert.deepEqual(snapshot.workstreams[0]?.repositoryWorkingLocations, [])
  assert.equal(snapshot.workstreams[1]?.id, healthy.snapshot.workstreams[1]?.id)
  assert.equal(snapshot.workstreams[1]?.unavailability, undefined)
})

test('does not reject Session lookup for a malformed recorded working location', async () => {
  const { authority, storageDirectory, workspace } = await createFixture()
  const created = await authority.createWorkstream(workspace.id, { goal: 'Keep locations trustworthy' })
  const workstream = created.snapshot.workstreams[0]
  assert.ok(workstream)
  const database = new Database(join(storageDirectory, 'application-state.sqlite'))
  database.prepare("UPDATE workstreams SET working_location = 'worktrees' WHERE id = ?").run(workstream.id)
  database
    .prepare(
      `INSERT INTO session_repository_locations
        (session_id, repository_id, kind, working_path, availability)
       SELECT ?, id, 'unknown', directory_path, 'available' FROM repositories LIMIT 1`
    )
    .run(created.sessionId)
  database.close()

  assert.equal(await authority.resolveOwnedSession(created.sessionId), undefined)
})

test('keeps malformed shared knowledge bounded to its owning Workstream', async () => {
  const { authority, storageDirectory, workspace } = await createFixture()
  const created = await authority.createWorkstream(workspace.id, { goal: 'Keep shared knowledge trustworthy' })
  const workstream = created.snapshot.workstreams[0]
  assert.ok(workstream)
  await authority.applyPiWorkstreamKnowledgeCommand(
    workstream.id,
    {
      type: 'put-record',
      expectedKnowledgeRevision: 0,
      expectedRecordRevision: 0,
      record: {
        id: 'finding-a',
        kind: 'finding',
        summary: 'A valid finding before corruption.',
        repositoryIds: [],
        evidenceIds: [],
      },
    },
    created.sessionId
  )
  const database = new Database(join(storageDirectory, 'application-state.sqlite'))
  database.prepare("UPDATE workstream_records SET payload = '{malformed'").run()
  database.close()

  const unavailable = (await authority.getWorkstreamSnapshot(workspace.id)).workstreams[0]

  assert.match(unavailable?.unavailability ?? '', /persisted Workstream record is malformed/)
  assert.deepEqual(unavailable?.sessions, [])
})

test('does not resolve Session capability for malformed shared Workstream knowledge', async () => {
  const { authority, storageDirectory, workspace } = await createFixture()
  const created = await authority.createWorkstream(workspace.id, { goal: 'Keep shared knowledge trustworthy' })
  const workstream = created.snapshot.workstreams[0]
  assert.ok(workstream)
  const database = new Database(join(storageDirectory, 'application-state.sqlite'))
  database
    .prepare("UPDATE workstream_knowledge SET knowledge_revision = 'unknown' WHERE workstream_id = ?")
    .run(workstream.id)
  database.close()

  assert.equal(await authority.resolveOwnedSession(created.sessionId), undefined)
})

test('bounds a malformed persisted Session to its owning Workstream', async () => {
  const storageDirectory = await mkdtemp(join(tmpdir(), 'pi-workspace-workstreams-'))
  temporaryDirectories.push(storageDirectory)
  const realStore = await createPiSessionFileStore(storageDirectory)
  const failingStore: PiSessionFileStore = {
    ...realStore,
    async create() {
      throw new Error('leave the Session pending')
    },
  }
  const { authority, workspace } = await createFixtureIn(storageDirectory, failingStore)
  await authority.createWorkstream(workspace.id, { goal: 'Keep availability trustworthy' })
  const database = new Database(join(storageDirectory, 'application-state.sqlite'))
  database.prepare("UPDATE sessions SET availability = 'unknown'").run()
  database.close()

  const workstream = (await authority.getWorkstreamSnapshot(workspace.id)).workstreams[0]

  assert.match(workstream?.unavailability ?? '', /persisted Session availability is malformed/)
  assert.deepEqual(workstream?.sessions, [])
})

test('returns the committed creation when JSONL creation remains pending', async () => {
  const storageDirectory = await mkdtemp(join(tmpdir(), 'pi-workspace-workstreams-'))
  temporaryDirectories.push(storageDirectory)
  const realStore = await createPiSessionFileStore(storageDirectory)
  const failingStore: PiSessionFileStore = {
    ...realStore,
    async create() {
      throw new Error('simulated crash before file creation')
    },
  }
  const { authority, workspace } = await createFixtureIn(storageDirectory, failingStore)

  const created = await authority.createWorkstream(workspace.id, { goal: 'Recover me' })

  assert.equal(created.status, 'pending')
  assert.equal(created.snapshot.workstreams.length, 1)
  assert.equal(created.snapshot.workstreams[0]?.sessions.length, 1)
  assert.equal(created.snapshot.workstreams[0]?.sessions[0]?.id, created.sessionId)
  assert.equal(created.snapshot.workstreams[0]?.sessions[0]?.availability, 'unavailable')

  const restarted = await initializeApplicationAuthority(storageDirectory, { sqlite: bunSqlite })
  const snapshot = await restarted.getWorkstreamSnapshot(workspace.id)
  assert.equal(snapshot.workstreams.length, 1)
  assert.equal(snapshot.workstreams[0]?.sessions.length, 1)
  assert.equal(snapshot.workstreams[0]?.sessions[0]?.id, created.sessionId)
  assert.equal(snapshot.workstreams[0]?.sessions[0]?.availability, 'available')
})

test('reconnects to the committed creation when the process stops after the JSONL is written', async () => {
  const storageDirectory = await mkdtemp(join(tmpdir(), 'pi-workspace-workstreams-'))
  temporaryDirectories.push(storageDirectory)
  const realStore = await createPiSessionFileStore(storageDirectory)
  const failingStore: PiSessionFileStore = {
    ...realStore,
    async create(intent) {
      await realStore.create(intent)
      throw new Error('simulated crash after file creation')
    },
  }
  const { authority, workspace } = await createFixtureIn(storageDirectory, failingStore)

  const created = await authority.createWorkstream(workspace.id, { goal: 'Recover me' })

  assert.equal(created.status, 'pending')
  assert.equal(created.snapshot.workstreams.length, 1)
  assert.equal(created.snapshot.workstreams[0]?.sessions.length, 1)
  assert.equal(created.snapshot.workstreams[0]?.sessions[0]?.id, created.sessionId)

  const restarted = await initializeApplicationAuthority(storageDirectory, { sqlite: bunSqlite })
  const snapshot = await restarted.getWorkstreamSnapshot(workspace.id)
  assert.equal(snapshot.workstreams.length, 1)
  assert.equal(snapshot.workstreams[0]?.sessions.length, 1)
  assert.equal(snapshot.workstreams[0]?.sessions[0]?.id, created.sessionId)
  assert.equal(snapshot.workstreams[0]?.sessions[0]?.availability, 'available')
})

test('quarantines a mismatched pending JSONL without replacing it', async () => {
  const storageDirectory = await mkdtemp(join(tmpdir(), 'pi-workspace-workstreams-'))
  temporaryDirectories.push(storageDirectory)
  const realStore = await createPiSessionFileStore(storageDirectory)
  let mismatchedPath: string | undefined
  const mismatchedStore: PiSessionFileStore = {
    ...realStore,
    async create(intent) {
      if (!mismatchedPath) {
        mismatchedPath = intent.sessionPath
        await writeFile(intent.sessionPath, '{"unexpected":true}\n', 'utf8')
      }

      return realStore.create(intent)
    },
  }
  const { authority, workspace } = await createFixtureIn(storageDirectory, mismatchedStore)

  const created = await authority.createWorkstream(workspace.id, { goal: 'Quarantine me' })

  assert.equal(created.status, 'quarantined')
  assert.equal(created.snapshot.workstreams.length, 1)
  assert.equal(created.snapshot.workstreams[0]?.sessions.length, 1)
  assert.equal(created.snapshot.workstreams[0]?.sessions[0]?.availability, 'unavailable')
  assert.equal(await authority.resolveOwnedSession(created.sessionId), undefined)

  const restarted = await initializeApplicationAuthority(storageDirectory, { sqlite: bunSqlite })
  const snapshot = await restarted.getWorkstreamSnapshot(workspace.id)
  assert.equal(snapshot.workstreams[0]?.sessions[0]?.availability, 'unavailable')
  assert.ok(mismatchedPath)
  await assert.rejects(access(mismatchedPath))
})

test('does not fabricate a replacement for a missing finalized JSONL', async () => {
  const { authority, workspace } = await createFixture()
  const created = await authority.createWorkstream(workspace.id, { goal: 'Keep ownership' })
  const ownedSession = created.snapshot.workstreams[0]?.sessions[0]
  assert.ok(ownedSession)
  const resolution = await authority.resolveOwnedSession(ownedSession.id)
  assert.ok(resolution)
  await rm(resolution.sessionPath)

  const snapshot = await authority.getWorkstreamSnapshot(workspace.id)

  assert.equal(snapshot.workstreams[0]?.sessions[0]?.availability, 'unavailable')
  await assert.rejects(access(resolution.sessionPath))
})

test('marks only a finalized Session unavailable when its JSONL becomes malformed', async () => {
  const { authority, workspace } = await createFixture()
  const created = await authority.createWorkstream(workspace.id, { goal: 'Keep ownership' })
  const workstream = created.snapshot.workstreams[0]
  assert.ok(workstream)
  await authority.createWorkstreamSession(workstream.id, { mode: 'brainstorm' })
  const ownedSession = workstream.sessions[0]
  assert.ok(ownedSession)
  const resolution = await authority.resolveOwnedSession(ownedSession.id)
  assert.ok(resolution)
  await writeFile(resolution.sessionPath, '{not-json}\n', 'utf8')

  const snapshot = await authority.getWorkstreamSnapshot(workspace.id)
  const sessions = snapshot.workstreams[0]?.sessions ?? []

  assert.deepEqual(
    sessions.map((session) => session.availability),
    ['unavailable', 'available']
  )
})

async function createFixtureIn(
  storageDirectory: string,
  sessionFiles: PiSessionFileStore,
  inspectRepository?: RepositoryInspector
) {
  const repositoryPath = join(storageDirectory, 'repository')
  await exec('git', ['init', repositoryPath])
  const authority = await initializeApplicationAuthority(storageDirectory, {
    sqlite: bunSqlite,
    sessionFiles,
    inspectRepository,
  })
  const workspaces = await authority.createWorkspace('Workspace', [repositoryPath])
  const workspace = workspaces.workspaces[0]
  assert.ok(workspace)

  return { authority, workspace }
}
