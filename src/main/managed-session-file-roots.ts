import type { ManagedSessionRuntimePolicy } from '@/src/domain/managed-session'

export type ManagedSessionFileRoot = Readonly<{
  path: string
  prefix: string
}>

export function managedSessionFileRoots(policy: ManagedSessionRuntimePolicy): readonly ManagedSessionFileRoot[] {
  return policy.repositories.flatMap((repository) =>
    repository.availability === 'available' ? [{ path: repository.workingPath, prefix: repository.id }] : []
  )
}
