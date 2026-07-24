import type { ManagedSessionRuntimePolicy } from '@/src/domain/managed-session'
import type { PreparedSessionRepository } from './application-state'

export type ManagedSessionRuntimePolicyGuardOptions = Readonly<{
  policy: ManagedSessionRuntimePolicy
  resolvePolicy: () => Promise<ManagedSessionRuntimePolicy | undefined>
  prepareSessionRepository: (repositoryId: string) => Promise<PreparedSessionRepository>
}>

export interface ManagedSessionRuntimePolicyGuard {
  validate(): Promise<ManagedSessionRuntimePolicy>
  prepareRepository(repositoryId: string): Promise<PreparedSessionRepository>
}

export function createManagedSessionRuntimePolicyGuard(
  options: ManagedSessionRuntimePolicyGuardOptions,
  onPolicyFailure: (error: unknown) => void
): ManagedSessionRuntimePolicyGuard {
  let activePolicy = options.policy

  async function validate(): Promise<ManagedSessionRuntimePolicy> {
    try {
      const current = await requireCurrentPolicyIdentity(options, activePolicy)

      if (current.resourcePolicyRevision !== activePolicy.resourcePolicyRevision) {
        throw new Error('The managed Session runtime policy is stale.')
      }

      return current
    } catch (error) {
      onPolicyFailure(error)
      throw error
    }
  }

  async function prepareRepository(repositoryId: string): Promise<PreparedSessionRepository> {
    await validate()
    const prepared = await options.prepareSessionRepository(repositoryId)

    try {
      const current = await requireCurrentPolicyIdentity(options, activePolicy)
      if (current.resourcePolicyRevision !== prepared.resourcePolicyRevision) {
        throw new Error('The managed Session runtime policy is stale.')
      }

      activePolicy = current
    } catch (error) {
      onPolicyFailure(error)
      throw error
    }

    return prepared
  }

  return { validate, prepareRepository }
}

async function requireCurrentPolicyIdentity(
  options: ManagedSessionRuntimePolicyGuardOptions,
  expected: ManagedSessionRuntimePolicy
): Promise<ManagedSessionRuntimePolicy> {
  const current = await options.resolvePolicy()

  if (
    !current ||
    current.workspaceId !== expected.workspaceId ||
    current.workstreamId !== expected.workstreamId ||
    current.sessionId !== expected.sessionId ||
    current.mode !== expected.mode ||
    current.lifecycle !== expected.lifecycle ||
    current.runLeaseId !== expected.runLeaseId
  ) {
    throw new Error('The managed Session runtime policy is stale.')
  }

  return current
}
