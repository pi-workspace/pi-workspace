import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rename, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, test } from 'node:test'
import { initializeApplicationAuthority, type SqliteModule } from '@/src/main/application-state'

const exec = promisify(execFile)
const temporaryDirectories: string[] = []

type BunSqliteModule = Readonly<{
  Database: SqliteModule['DatabaseSync']
}>

const { Database } = (await Function('return import("bun:sqlite")')()) as BunSqliteModule

const bunSqlite: SqliteModule = {
  DatabaseSync: Database as unknown as SqliteModule['DatabaseSync'],
  async backup() {
    throw new Error('Backup is not exercised by the Bun test adapter.')
  },
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })))
})

async function createRepository(parentDirectory: string, name: string): Promise<string> {
  const directoryPath = join(parentDirectory, name)
  await exec('git', ['init', directoryPath])
  return directoryPath
}

async function createAuthority() {
  const storageDirectory = await mkdtemp(join(tmpdir(), 'pi-workspace-application-state-'))
  temporaryDirectories.push(storageDirectory)

  return {
    storageDirectory,
    authority: await initializeApplicationAuthority(storageDirectory, { sqlite: bunSqlite }),
  }
}

async function createWorkspaceWithTwoRepositories() {
  const { authority, storageDirectory } = await createAuthority()
  const firstRepositoryPath = await createRepository(storageDirectory, 'first-repository')
  const secondRepositoryPath = await createRepository(storageDirectory, 'second-repository')
  const initial = await authority.createWorkspace('Workspace', [firstRepositoryPath, secondRepositoryPath])
  const workspace = initial.workspaces[0]
  const firstMembership = workspace?.repositories[0]
  const secondMembership = workspace?.repositories[1]

  assert.ok(workspace)
  assert.ok(firstMembership)
  assert.ok(secondMembership)

  return { authority, initial, workspace, firstMembership, secondMembership }
}

test('stores application state with owner-only permissions', async () => {
  const { storageDirectory } = await createAuthority()

  assert.equal((await stat(storageDirectory)).mode & 0o777, 0o700)
  assert.equal((await stat(join(storageDirectory, 'application-state.json'))).mode & 0o777, 0o600)
  assert.equal((await stat(join(storageDirectory, 'application-state.sqlite'))).mode & 0o777, 0o600)
})

test('reuses one Repository identity across two Workspaces', async () => {
  const { authority, storageDirectory } = await createAuthority()
  const repositoryPath = await createRepository(storageDirectory, 'repository')

  const first = await authority.createWorkspace('First Workspace', [repositoryPath])
  const second = await authority.createWorkspace('Second Workspace', [repositoryPath])

  assert.equal(first.workspaces[0]?.repositories[0]?.id, second.workspaces[1]?.repositories[0]?.id)
})

test('creates an independent membership identity for each Workspace', async () => {
  const { authority, storageDirectory } = await createAuthority()
  const repositoryPath = await createRepository(storageDirectory, 'repository')

  const first = await authority.createWorkspace('First Workspace', [repositoryPath])
  const second = await authority.createWorkspace('Second Workspace', [repositoryPath])

  assert.notEqual(
    first.workspaces[0]?.repositories[0]?.membershipId,
    second.workspaces[1]?.repositories[0]?.membershipId
  )
})

test('persists Workspaces across authority restart', async () => {
  const { authority, storageDirectory } = await createAuthority()
  const repositoryPath = await createRepository(storageDirectory, 'repository')
  await authority.createWorkspace('First Workspace', [repositoryPath])
  await authority.createWorkspace('Second Workspace', [repositoryPath])

  const reloadedAuthority = await initializeApplicationAuthority(storageDirectory, { sqlite: bunSqlite })
  const reloaded = await reloadedAuthority.getWorkspaces()

  assert.deepEqual(
    reloaded.workspaces.map((workspace) => workspace.name),
    ['First Workspace', 'Second Workspace']
  )
})

test('preserves two Workspace memberships created concurrently for one Repository', async () => {
  const { authority, storageDirectory } = await createAuthority()
  const repositoryPath = await createRepository(storageDirectory, 'repository')

  await Promise.all([
    authority.createWorkspace('First Workspace', [repositoryPath]),
    authority.createWorkspace('Second Workspace', [repositoryPath]),
  ])

  const workspaces = (await authority.getWorkspaces()).workspaces
  const repositoryIds = workspaces.flatMap((workspace) => workspace.repositories.map((repository) => repository.id))

  assert.equal(workspaces.length, 2)
  assert.equal(new Set(repositoryIds).size, 1)
})

test('rejects duplicate Repository selections without creating a Workspace', async () => {
  const { authority, storageDirectory } = await createAuthority()
  const repositoryPath = await createRepository(storageDirectory, 'repository')
  const nestedPath = join(repositoryPath, 'nested')
  await mkdir(nestedPath)

  await assert.rejects(authority.createWorkspace('Workspace', [repositoryPath, nestedPath]), /duplicate or overlapping/)
  assert.deepEqual((await authority.getWorkspaces()).workspaces, [])
})

test('rejects globally overlapping Repository roots without partial rows', async () => {
  const { authority, storageDirectory } = await createAuthority()
  const parentRepositoryPath = await createRepository(storageDirectory, 'parent-repository')
  const nestedRepositoryPath = await createRepository(parentRepositoryPath, 'nested-repository')
  await authority.createWorkspace('First Workspace', [parentRepositoryPath])

  await assert.rejects(
    authority.createWorkspace('Second Workspace', [nestedRepositoryPath]),
    /cannot overlap registered Repository roots/
  )

  const workspaces = (await authority.getWorkspaces()).workspaces
  assert.deepEqual(
    workspaces.map((workspace) => workspace.name),
    ['First Workspace']
  )
})

test('rejects relationships that do not reference current members without changing state', async () => {
  const { authority, initial, workspace, firstMembership } = await createWorkspaceWithTwoRepositories()
  await assert.rejects(
    authority.updateWorkspaceMembership(workspace.id, firstMembership.membershipId, {
      role: 'Service',
      relationships: ['missing-membership'],
      validationCommands: ['bun test'],
    }),
    /current Workspace members/
  )

  const unchanged = await authority.getWorkspaces()
  assert.equal(unchanged.revision, initial.revision)
})

test('normalizes user-authored membership metadata', async () => {
  const { authority, workspace, firstMembership, secondMembership } = await createWorkspaceWithTwoRepositories()

  const updated = await authority.updateWorkspaceMembership(workspace.id, firstMembership.membershipId, {
    role: ' Service ',
    relationships: [secondMembership.membershipId, secondMembership.membershipId],
    validationCommands: [' bun test ', '', 'bun test'],
  })
  const repository = updated.workspaces[0]?.repositories[0]

  assert.equal(repository?.role, 'Service')
  assert.deepEqual(repository?.relationships, [secondMembership.membershipId])
  assert.deepEqual(repository?.validationCommands, ['bun test'])
})

test('renames a Workspace', async () => {
  const { authority, workspace } = await createWorkspaceWithTwoRepositories()

  const renamed = await authority.renameWorkspace(workspace.id, 'Renamed Workspace')

  assert.equal(renamed.workspaces[0]?.name, 'Renamed Workspace')
})

test('prevents removing the final Repository membership', async () => {
  const { authority, workspace, firstMembership, secondMembership } = await createWorkspaceWithTwoRepositories()
  await authority.removeWorkspaceRepository(workspace.id, firstMembership.membershipId)

  await assert.rejects(
    authority.removeWorkspaceRepository(workspace.id, secondMembership.membershipId),
    /cannot be left without a Repository/
  )

  assert.equal((await authority.getWorkspaces()).workspaces[0]?.repositories.length, 1)
})

test('removing a Repository membership removes incoming relationships to it', async () => {
  const { authority, workspace, firstMembership, secondMembership } = await createWorkspaceWithTwoRepositories()

  await authority.updateWorkspaceMembership(workspace.id, firstMembership.membershipId, {
    role: '',
    relationships: [secondMembership.membershipId],
    validationCommands: [],
  })

  const updated = await authority.removeWorkspaceRepository(workspace.id, secondMembership.membershipId)

  assert.deepEqual(updated.workspaces[0]?.repositories[0]?.relationships, [])
})

test('keeps a missing Repository visible as unavailable', async () => {
  const { authority, storageDirectory } = await createAuthority()
  const repositoryPath = await createRepository(storageDirectory, 'repository')
  await authority.createWorkspace('Workspace', [repositoryPath])
  const missingRepositoryPath = join(storageDirectory, 'missing-repository')

  await rename(repositoryPath, missingRepositoryPath)
  assert.equal((await authority.getWorkspaces()).workspaces[0]?.repositories[0]?.availability, 'unavailable')
})

test('recovers an unavailable Repository restored at its recorded location', async () => {
  const { authority, storageDirectory } = await createAuthority()
  const repositoryPath = await createRepository(storageDirectory, 'repository')
  await authority.createWorkspace('Workspace', [repositoryPath])
  const missingRepositoryPath = join(storageDirectory, 'missing-repository')

  await rename(repositoryPath, missingRepositoryPath)
  await rename(missingRepositoryPath, repositoryPath)
  assert.equal((await authority.getWorkspaces()).workspaces[0]?.repositories[0]?.availability, 'available')
})
