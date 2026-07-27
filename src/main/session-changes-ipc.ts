import type { ApplicationAuthority } from '@/src/main/application-state'
import { inspectGitRepository } from '@/src/main/git-repositories'
import { handleTrustedIpc } from '@/src/main/trusted-ipc'
import {
  parseSessionChangesRequest,
  parseSessionFileDiffRequest,
  parseSessionFileStageRequest,
  sessionChangesIpcChannels,
} from '@/src/session-changes-ipc'
import {
  inspectRepositoryChanges,
  loadRepositoryFileDiff,
  setRepositoryFileStaged,
  type SessionChangeRepository,
} from './session-changes'

let initialized = false

export function initializeSessionChanges(authority: ApplicationAuthority): void {
  if (initialized) return
  initialized = true

  handleTrustedIpc(sessionChangesIpcChannels.getSnapshot, async (_event, value: unknown) => {
    const request = parseSessionChangesRequest(value)
    if (!request) throw new TypeError('A Session is required.')

    const repositories = await resolveRepositories(authority, request.sessionId)

    return {
      sessionId: request.sessionId,
      repositories: await Promise.all(repositories.map(inspectRepositoryChanges)),
    }
  })

  handleTrustedIpc(sessionChangesIpcChannels.loadFileDiff, async (_event, value: unknown) => {
    const request = parseSessionFileDiffRequest(value)
    if (!request) throw new TypeError('A Session changed file is required.')

    const repositories = await resolveRepositories(authority, request.sessionId)
    const repository = repositories.find((candidate) => candidate.repositoryId === request.repositoryId)
    if (!repository) return { status: 'unavailable', message: 'The Repository is not writable by this Session.' }

    return loadRepositoryFileDiff(repository, request)
  })

  handleTrustedIpc(sessionChangesIpcChannels.setFileStaged, async (_event, value: unknown) => {
    const request = parseSessionFileStageRequest(value)
    if (!request) throw new TypeError('A Session changed file and staging state are required.')

    const repositories = await resolveRepositories(authority, request.sessionId)
    const repository = repositories.find((candidate) => candidate.repositoryId === request.repositoryId)
    if (!repository) throw new Error('The Repository is not writable by this Session.')

    await setRepositoryFileStaged(repository, request)

    return {
      sessionId: request.sessionId,
      repositories: await Promise.all(repositories.map(inspectRepositoryChanges)),
    }
  })
}

async function resolveRepositories(
  authority: ApplicationAuthority,
  sessionId: Parameters<ApplicationAuthority['resolveSessionChangeRepositories']>[0]
): Promise<readonly SessionChangeRepository[]> {
  const authorized = await authority.resolveSessionChangeRepositories(sessionId)

  return (
    await Promise.all(
      authorized.map(async (repository) => {
        try {
          const inspected = await inspectGitRepository(repository.workingPath)
          if (inspected.directoryPath !== repository.workingPath) return undefined

          return repository
        } catch {
          return undefined
        }
      })
    )
  ).flatMap((repository) => (repository ? [repository] : []))
}
