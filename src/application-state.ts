export const applicationStateSchemaVersion = 7

export type InstallationMarker = Readonly<{
  generationId: string
}>

export type ApplicationStateMetadata = Readonly<{
  generationId: string
  schemaVersion: number
  integrity: 'ok' | 'failed'
}>

export type ApplicationStateStartup =
  | Readonly<{ status: 'first-launch' }>
  | Readonly<{ status: 'ready' }>
  | Readonly<{ status: 'recovery-only'; diagnostic: string }>

export type WorkspaceRepositorySnapshot = Readonly<{
  membershipId: string
  id: string
  name: string
  directoryPath: string
  availability: 'available' | 'unavailable'
  role: string
  relationships: readonly string[]
  validationCommands: readonly string[]
}>

export type WorkspaceMembershipUpdate = Readonly<{
  role: string
  relationships: readonly string[]
  validationCommands: readonly string[]
}>

export type WorkspaceSnapshot = Readonly<{
  id: string
  name: string
  repositories: readonly WorkspaceRepositorySnapshot[]
}>

export type WorkspacesSnapshot = Readonly<{
  revision: number
  workspaces: readonly WorkspaceSnapshot[]
}>

/**
 * Classifies application authority before any Repository or Session capability
 * is made available. Missing state is only safe on a genuine first launch.
 */
export function classifyApplicationState(
  marker: InstallationMarker | undefined,
  metadata: ApplicationStateMetadata | undefined
): ApplicationStateStartup {
  if (!marker && !metadata) {
    return { status: 'first-launch' }
  }

  if (!marker) {
    return { status: 'recovery-only', diagnostic: 'The installation marker is missing.' }
  }

  if (!metadata) {
    return { status: 'recovery-only', diagnostic: 'The application database is missing or unreadable.' }
  }

  if (metadata.schemaVersion !== applicationStateSchemaVersion) {
    return { status: 'recovery-only', diagnostic: 'The application database has an unsupported schema version.' }
  }

  if (metadata.integrity !== 'ok') {
    return { status: 'recovery-only', diagnostic: 'The application database integrity check failed.' }
  }

  if (marker.generationId !== metadata.generationId) {
    return { status: 'recovery-only', diagnostic: 'The installation marker and database generation do not match.' }
  }

  return { status: 'ready' }
}
