import type { ManagedSessionRuntimePolicy } from '@/src/domain/managed-session'

export function projectWorkspaceOverview(policy: ManagedSessionRuntimePolicy) {
  return {
    workspaceId: policy.workspaceId,
    workstreamId: policy.workstreamId,
    sessionId: policy.sessionId,
    goal: policy.goal,
    repositories: policy.repositories.map((repository) => ({
      id: repository.id,
      name: repository.name,
      availability: repository.availability,
      role: repository.role,
      relationships: repository.relationships,
      validationCommands: repository.validationCommands,
      ...(repository.availability === 'available'
        ? { workingPath: repository.workingPath, workingLocation: repository.workingLocation }
        : {}),
    })),
  }
}

export function managedSessionMethodology(policy: ManagedSessionRuntimePolicy): string {
  const repositories = projectWorkspaceOverview(policy).repositories

  return [
    'You are operating a Railyard Workstream Session. The Workstream groups multiple Sessions toward a common goal.',
    `Workstream goal: ${policy.goal}`,
    'The selected Repository context for this Workstream is:',
    JSON.stringify(repositories, null, 2),
    'Use only these Repositories for Workstream Repository work. Call workspace_overview whenever you need to refresh this metadata.',
    'Before modifying a Repository, call prepare_repository with its id. Make and validate all changes in the returned Session working path, whether it is the current checkout or a user-selected Session worktree.',
  ].join('\n')
}
