import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import { type WorkspaceMembershipUpdate, type WorkspacesSnapshot } from '@/src/application-state'
import { inspectGitRepository, repositoryRootsOverlap, type InspectedGitRepository } from '@/src/main/git-repositories'
import type { SqliteDatabase } from './sqlite'
import { assertRepositoryMembershipRemovalAllowed } from './workstream-knowledge-store'

type RepositoryInspector = (directoryPath: string) => Promise<InspectedGitRepository>
type SelectedRepository = Awaited<ReturnType<typeof inspectGitRepository>>

type WorkspaceRepositoryStoreOptions = Readonly<{
  openDatabase: () => SqliteDatabase
  inspectRepository: RepositoryInspector
  incrementRevision: (database: SqliteDatabase) => void
}>

export function createWorkspaceRepositoryStore({
  openDatabase,
  inspectRepository,
  incrementRevision,
}: WorkspaceRepositoryStoreOptions) {
  async function getWorkspaces(): Promise<WorkspacesSnapshot> {
    const database = openDatabase()

    try {
      await refreshRepositoryAvailability(database, inspectRepository, incrementRevision)
      const rows = database
        .prepare(
          `SELECT w.id AS workspace_id, w.name AS workspace_name, m.id AS membership_id, r.id AS repository_id,
                  r.directory_path, r.availability, m.role, m.relationships, m.validation_commands
             FROM workspaces w
             LEFT JOIN workspace_repositories m ON m.workspace_id = w.id
             LEFT JOIN repositories r ON r.id = m.repository_id
             ORDER BY w.name, r.directory_path`
        )
        .all()
      const workspaces = new Map<
        string,
        { id: string; name: string; repositories: WorkspacesSnapshot['workspaces'][number]['repositories'][number][] }
      >()

      for (const row of rows) {
        const workspaceId = String(row.workspace_id)
        let workspace = workspaces.get(workspaceId)

        if (!workspace) {
          workspace = { id: workspaceId, name: String(row.workspace_name), repositories: [] }
          workspaces.set(workspaceId, workspace)
        }

        if (typeof row.repository_id === 'string') {
          workspace.repositories.push({
            membershipId: String(row.membership_id),
            id: row.repository_id,
            name: repositoryName(String(row.directory_path)),
            directoryPath: String(row.directory_path),
            availability: row.availability === 'available' ? 'available' : 'unavailable',
            role: String(row.role),
            relationships: parseStringArray(row.relationships),
            validationCommands: parseStringArray(row.validation_commands),
          })
        }
      }

      const revision = Number(database.prepare("SELECT value FROM metadata WHERE key = 'revision'").get()?.value ?? 0)
      return { revision, workspaces: [...workspaces.values()] }
    } finally {
      database.close()
    }
  }

  async function createWorkspace(name: string, selectedDirectoryPaths: readonly string[]): Promise<WorkspacesSnapshot> {
    const workspaceName = normalizeWorkspaceName(name)
    const repositories = await inspectSelectedRepositories(selectedDirectoryPaths)
    const database = openDatabase()

    try {
      database.exec('BEGIN IMMEDIATE;')
      const workspaceId = randomUUID()
      database.prepare('INSERT INTO workspaces (id, name) VALUES (?, ?)').run(workspaceId, workspaceName)
      registerRepositories(database, workspaceId, repositories)
      incrementRevision(database)
      database.exec('COMMIT;')
    } catch (error) {
      database.exec('ROLLBACK;')
      throw error
    } finally {
      database.close()
    }

    return getWorkspaces()
  }

  async function renameWorkspace(workspaceId: string, name: string): Promise<WorkspacesSnapshot> {
    const workspaceName = normalizeWorkspaceName(name)
    const database = openDatabase()

    try {
      database.exec('BEGIN IMMEDIATE;')
      const workspace = database.prepare('SELECT id FROM workspaces WHERE id = ?').get(workspaceId)
      if (!workspace) throw new TypeError('The Workspace no longer exists.')
      database
        .prepare('UPDATE workspaces SET name = ?, metadata_revision = metadata_revision + 1 WHERE id = ?')
        .run(workspaceName, workspaceId)
      incrementRevision(database)
      database.exec('COMMIT;')
    } catch (error) {
      database.exec('ROLLBACK;')
      throw error
    } finally {
      database.close()
    }

    return getWorkspaces()
  }

  async function addWorkspaceRepositories(
    workspaceId: string,
    selectedDirectoryPaths: readonly string[]
  ): Promise<WorkspacesSnapshot> {
    const repositories = await inspectSelectedRepositories(selectedDirectoryPaths)
    const database = openDatabase()

    try {
      database.exec('BEGIN IMMEDIATE;')
      if (!database.prepare('SELECT id FROM workspaces WHERE id = ?').get(workspaceId)) {
        throw new TypeError('The Workspace no longer exists.')
      }
      registerRepositories(database, workspaceId, repositories)
      database.prepare('UPDATE workspaces SET metadata_revision = metadata_revision + 1 WHERE id = ?').run(workspaceId)
      incrementRevision(database)
      database.exec('COMMIT;')
    } catch (error) {
      database.exec('ROLLBACK;')
      throw error
    } finally {
      database.close()
    }

    return getWorkspaces()
  }

  async function removeWorkspaceRepository(workspaceId: string, membershipId: string): Promise<WorkspacesSnapshot> {
    const database = openDatabase()

    try {
      database.exec('BEGIN IMMEDIATE;')
      const membership = database
        .prepare('SELECT id, repository_id FROM workspace_repositories WHERE id = ? AND workspace_id = ?')
        .get(membershipId, workspaceId)
      const count = Number(
        database.prepare('SELECT COUNT(*) AS count FROM workspace_repositories WHERE workspace_id = ?').get(workspaceId)
          ?.count ?? 0
      )
      if (!membership) throw new TypeError('The Repository membership no longer exists.')
      if (count <= 1) throw new TypeError('A Workspace cannot be left without a Repository.')

      assertRepositoryMembershipRemovalAllowed(database, workspaceId, String(membership.repository_id))

      const relatedMemberships = database
        .prepare('SELECT id, relationships FROM workspace_repositories WHERE workspace_id = ? AND id != ?')
        .all(workspaceId, membershipId)

      for (const relatedMembership of relatedMemberships) {
        const relationships = parseStringArray(relatedMembership.relationships)
        const retainedRelationships = relationships.filter((relationship) => relationship !== membershipId)

        if (retainedRelationships.length !== relationships.length) {
          database
            .prepare('UPDATE workspace_repositories SET relationships = ? WHERE id = ?')
            .run(JSON.stringify(retainedRelationships), relatedMembership.id)
        }
      }

      database.prepare('DELETE FROM workspace_repositories WHERE id = ?').run(membershipId)
      database.prepare('UPDATE workspaces SET metadata_revision = metadata_revision + 1 WHERE id = ?').run(workspaceId)
      incrementRevision(database)
      database.exec('COMMIT;')
    } catch (error) {
      database.exec('ROLLBACK;')
      throw error
    } finally {
      database.close()
    }

    return getWorkspaces()
  }

  async function updateWorkspaceMembership(
    workspaceId: string,
    membershipId: string,
    update: WorkspaceMembershipUpdate
  ): Promise<WorkspacesSnapshot> {
    const membershipUpdate = normalizeWorkspaceMembershipUpdate(update)
    const database = openDatabase()

    try {
      database.exec('BEGIN IMMEDIATE;')
      const membership = database
        .prepare('SELECT id FROM workspace_repositories WHERE id = ? AND workspace_id = ?')
        .get(membershipId, workspaceId)

      if (!membership) throw new TypeError('The Repository membership no longer exists.')

      const memberships = database
        .prepare('SELECT id FROM workspace_repositories WHERE workspace_id = ?')
        .all(workspaceId)
        .map((candidate) => String(candidate.id))

      if (membershipUpdate.relationships.some((relationship) => !memberships.includes(relationship))) {
        throw new TypeError('Repository relationships must reference current Workspace members.')
      }

      database
        .prepare('UPDATE workspace_repositories SET role = ?, relationships = ?, validation_commands = ? WHERE id = ?')
        .run(
          membershipUpdate.role,
          JSON.stringify(membershipUpdate.relationships),
          JSON.stringify(membershipUpdate.validationCommands),
          membershipId
        )
      database.prepare('UPDATE workspaces SET metadata_revision = metadata_revision + 1 WHERE id = ?').run(workspaceId)
      incrementRevision(database)
      database.exec('COMMIT;')
    } catch (error) {
      database.exec('ROLLBACK;')
      throw error
    } finally {
      database.close()
    }

    return getWorkspaces()
  }

  return {
    getWorkspaces,
    createWorkspace,
    renameWorkspace,
    addWorkspaceRepositories,
    removeWorkspaceRepository,
    updateWorkspaceMembership,
  }
}

async function inspectSelectedRepositories(
  selectedDirectoryPaths: readonly string[]
): Promise<readonly SelectedRepository[]> {
  if (selectedDirectoryPaths.length === 0) {
    throw new TypeError('Select at least one local Git Repository.')
  }

  const repositories = await Promise.all(selectedDirectoryPaths.map(inspectGitRepository))
  for (const [index, repository] of repositories.entries()) {
    if (
      repositories
        .slice(0, index)
        .some((existing) => repositoryRootsOverlap(existing.directoryPath, repository.directoryPath))
    ) {
      throw new TypeError('A Workspace cannot contain duplicate or overlapping Repository roots.')
    }
  }

  return repositories
}

function registerRepositories(
  database: SqliteDatabase,
  workspaceId: string,
  repositories: readonly SelectedRepository[]
): void {
  const registered = database.prepare('SELECT id, directory_path FROM repositories').all()

  for (const repository of repositories) {
    const existing = registered.find((candidate) => candidate.directory_path === repository.directoryPath)
    if (
      registered.some(
        (candidate) =>
          candidate.directory_path !== repository.directoryPath &&
          repositoryRootsOverlap(String(candidate.directory_path), repository.directoryPath)
      )
    ) {
      throw new TypeError('Repository roots cannot overlap registered Repository roots.')
    }

    const repositoryId = existing ? String(existing.id) : randomUUID()
    if (!existing) {
      database
        .prepare(
          'INSERT INTO repositories (id, directory_path, common_directory_path, availability) VALUES (?, ?, ?, ?)'
        )
        .run(repositoryId, repository.directoryPath, repository.commonDirectoryPath, 'available')
      registered.push({ id: repositoryId, directory_path: repository.directoryPath })
    }

    if (
      database
        .prepare('SELECT id FROM workspace_repositories WHERE workspace_id = ? AND repository_id = ?')
        .get(workspaceId, repositoryId)
    ) {
      throw new TypeError('The Repository is already a member of this Workspace.')
    }

    database
      .prepare('INSERT INTO workspace_repositories (id, workspace_id, repository_id) VALUES (?, ?, ?)')
      .run(randomUUID(), workspaceId, repositoryId)
  }
}

function normalizeWorkspaceName(name: string): string {
  const normalizedName = name.trim()
  if (!normalizedName) throw new TypeError('A Workspace name is required.')
  return normalizedName
}

function normalizeWorkspaceMembershipUpdate(update: WorkspaceMembershipUpdate): WorkspaceMembershipUpdate {
  return {
    role: update.role.trim(),
    relationships: normalizeStringList(update.relationships),
    validationCommands: normalizeStringList(update.validationCommands),
  }
}

function normalizeStringList(values: readonly string[]): readonly string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

export function repositoryName(directoryPath: string): string {
  return basename(directoryPath) || directoryPath
}

export function parseStringArray(value: unknown): readonly string[] {
  try {
    const parsed: unknown = JSON.parse(String(value))
    return Array.isArray(parsed) && parsed.every((item) => typeof item === 'string') ? parsed : []
  } catch {
    return []
  }
}

export async function inspectRepositoryAvailability(
  directoryPath: string,
  commonDirectoryPath: string,
  inspectRepository: RepositoryInspector
): Promise<'available' | 'unavailable'> {
  return inspectRepository(directoryPath).then(
    (current) =>
      current.directoryPath === directoryPath && current.commonDirectoryPath === commonDirectoryPath
        ? 'available'
        : 'unavailable',
    () => 'unavailable'
  )
}

export async function refreshRepositoryAvailability(
  database: SqliteDatabase,
  inspectRepository: RepositoryInspector,
  incrementRevision: (database: SqliteDatabase) => void
): Promise<void> {
  const repositories = database
    .prepare('SELECT id, directory_path, common_directory_path, availability FROM repositories')
    .all()

  for (const repository of repositories) {
    const availability = await inspectRepositoryAvailability(
      String(repository.directory_path),
      String(repository.common_directory_path),
      inspectRepository
    )

    if (availability !== repository.availability) {
      database.prepare('UPDATE repositories SET availability = ? WHERE id = ?').run(availability, repository.id)
      database
        .prepare(
          `UPDATE workspaces
              SET metadata_revision = metadata_revision + 1
            WHERE id IN (
              SELECT workspace_id
                FROM workspace_repositories
               WHERE repository_id = ?
            )`
        )
        .run(repository.id)
      incrementRevision(database)
    }
  }
}
