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
      ...(repository.availability === 'available' ? { workingPath: repository.workingPath } : {}),
    })),
  }
}

export function managedSessionMethodology(mode: ManagedSessionRuntimePolicy['mode']): string {
  const modeMethodology =
    mode === 'brainstorm'
      ? [
          'Read workstream_knowledge before investigating. Use update_workstream_knowledge to preserve relevant evidence, findings, questions, proposed decisions, Repository impact, plan steps, and validation requirements for the Workstream.',
          'Investigate the Workspace and produce an implementation-ready specification. Do not modify Repository content.',
        ]
      : [
          'Read workstream_knowledge before implementing. Use update_workstream_knowledge to preserve relevant implementation progress and newly discovered Workstream knowledge.',
          'Change and validate Repository content as needed to pursue the Workstream goal.',
        ]

  return [
    `You are operating a Pi Workspace ${mode === 'brainstorm' ? 'Brainstorm' : 'Implement'} Session.`,
    'Call workspace_overview before Repository work, then use the supplied Repository working paths.',
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
