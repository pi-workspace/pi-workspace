import type { ApplicationStateStartup, WorkspaceMembershipUpdate, WorkspacesSnapshot } from '@/src/application-state'

export const applicationStateIpcChannels = {
  getStartup: 'application-state:get-startup',
  createBackup: 'application-state:create-backup',
  reset: 'application-state:reset',
  getWorkspaces: 'application-state:get-workspaces',
  createWorkspace: 'application-state:create-workspace',
  renameWorkspace: 'application-state:rename-workspace',
  addWorkspaceRepositories: 'application-state:add-workspace-repositories',
  removeWorkspaceRepository: 'application-state:remove-workspace-repository',
  updateWorkspaceMembership: 'application-state:update-workspace-membership',
} as const

export type CreateWorkspaceOutcome =
  Readonly<{ status: 'cancelled' }> | Readonly<{ status: 'created'; snapshot: WorkspacesSnapshot }>

export type ApplicationStateBridge = Readonly<{
  getStartup(): Promise<ApplicationStateStartup>
  createBackup(): Promise<string>
  reset(confirmation: string): Promise<ApplicationStateStartup>
  getWorkspaces(): Promise<WorkspacesSnapshot>
  createWorkspace(name: string): Promise<CreateWorkspaceOutcome>
  renameWorkspace(workspaceId: string, name: string): Promise<WorkspacesSnapshot>
  addWorkspaceRepositories(workspaceId: string): Promise<CreateWorkspaceOutcome>
  removeWorkspaceRepository(workspaceId: string, membershipId: string): Promise<WorkspacesSnapshot>
  updateWorkspaceMembership(
    workspaceId: string,
    membershipId: string,
    update: WorkspaceMembershipUpdate
  ): Promise<WorkspacesSnapshot>
}>
