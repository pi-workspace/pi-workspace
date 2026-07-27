import type { ManagedSessionRuntimePolicy } from '@/src/domain/managed-session'
import type { WorkstreamKnowledgeCommand } from '@/src/domain/workstream-knowledge-transitions'
import { parseWorkstreamKnowledgeCommand } from '@/src/workstream-knowledge-ipc'

export function projectWorkspaceOverview(policy: ManagedSessionRuntimePolicy) {
  return {
    workspaceId: policy.workspaceId,
    workstreamId: policy.workstreamId,
    sessionId: policy.sessionId,
    mode: policy.mode,
    repositories: policy.repositories.map((repository) => ({
      id: repository.id,
      name: repository.name,
      availability: repository.availability,
      role: repository.role,
      relationships: repository.relationships,
      ...(repository.availability === 'available'
        ? { workingPath: repository.workingPath, workingLocation: repository.workingLocation }
        : {}),
    })),
  }
}

export function managedSessionMethodology(mode: ManagedSessionRuntimePolicy['mode']): string {
  const modeMethodology =
    mode === 'brainstorm'
      ? [
          'Call workspace_overview before Repository work, then use the supplied Repository working paths.',
          'Read workstream_knowledge before investigating. Use update_workstream_knowledge to preserve relevant evidence, findings, questions, proposed decisions, Repository impact, plan steps, and validation requirements for the Workstream.',
          'Investigate the Workspace and produce an implementation-ready specification. Do not modify Repository content.',
        ]
      : [
          'Call workspace_overview before Repository work.',
          'Read workstream_knowledge before implementing. Use update_workstream_knowledge to preserve relevant implementation progress and newly discovered Workstream knowledge.',
          'Before modifying a Repository, call prepare_repository with its id. Make and validate all changes in the returned Session working path, whether it is the current checkout or a user-selected Session worktree.',
        ]

  return [
    `You are operating a Railyard ${mode === 'brainstorm' ? 'Brainstorm' : 'Implement'} Session.`,
    ...modeMethodology,
  ].join('\n')
}

export function parsePiWorkstreamKnowledgeMutation(value: unknown): WorkstreamKnowledgeCommand | undefined {
  if (typeof value !== 'object' || value === null) return undefined

  const input = value as Record<string, unknown>
  if (input.operation !== 'put-record' && input.operation !== 'tombstone-record') return undefined

  return parseWorkstreamKnowledgeCommand({
    ...input,
    type: input.operation,
  })
}
