import { BrowserWindow, dialog } from 'electron'
import type { ApplicationAuthority } from '@/src/main/application-state'
import { createExclusiveOperation } from '@/src/main/exclusive-operation'
import { applicationStateIpcChannels, type CreateWorkspaceOutcome } from '@/src/application-state-ipc'
import type { WorkspaceMembershipUpdate } from '@/src/application-state'
import { handleTrustedIpc } from '@/src/main/trusted-ipc'

let initialized = false
const repositoryDialog = createExclusiveOperation('A Repository selection dialog is already open.')

export function initializeApplicationStateIpc(authority: ApplicationAuthority): void {
  if (initialized) {
    return
  }

  initialized = true
  handleTrustedIpc(applicationStateIpcChannels.getStartup, () => authority.startup)
  handleTrustedIpc(applicationStateIpcChannels.getWorkspaces, () => authority.getWorkspaces())
  handleTrustedIpc(applicationStateIpcChannels.createBackup, () => authority.createBackup())
  handleTrustedIpc(applicationStateIpcChannels.reset, (_event, confirmation: unknown) => {
    return confirmation === 'RESET'
      ? authority.reset()
      : Promise.reject(new Error('Type RESET to confirm an application-state reset.'))
  })
  handleTrustedIpc(
    applicationStateIpcChannels.createWorkspace,
    async (event, name: unknown): Promise<CreateWorkspaceOutcome> => {
      if (typeof name !== 'string') {
        throw new TypeError('A Workspace name is required.')
      }

      const parentWindow = BrowserWindow.fromWebContents(event.sender)
      const selection = await repositoryDialog.run(() =>
        parentWindow
          ? dialog.showOpenDialog(parentWindow, {
              title: 'Select Repository',
              properties: ['openDirectory', 'multiSelections'],
            })
          : dialog.showOpenDialog({ title: 'Select Repository', properties: ['openDirectory', 'multiSelections'] })
      )

      if (selection.canceled || selection.filePaths.length === 0) {
        return { status: 'cancelled' }
      }

      return { status: 'created', snapshot: await authority.createWorkspace(name, selection.filePaths) }
    }
  )
  handleTrustedIpc(applicationStateIpcChannels.renameWorkspace, (_event, workspaceId: unknown, name: unknown) => {
    if (typeof workspaceId !== 'string' || typeof name !== 'string') {
      throw new TypeError('A Workspace and name are required.')
    }

    return authority.renameWorkspace(workspaceId, name)
  })
  handleTrustedIpc(
    applicationStateIpcChannels.addWorkspaceRepositories,
    async (event, workspaceId: unknown): Promise<CreateWorkspaceOutcome> => {
      if (typeof workspaceId !== 'string') throw new TypeError('A Workspace is required.')

      const parentWindow = BrowserWindow.fromWebContents(event.sender)
      const selection = await repositoryDialog.run(() =>
        parentWindow
          ? dialog.showOpenDialog(parentWindow, {
              title: 'Select Repositories',
              properties: ['openDirectory', 'multiSelections'],
            })
          : dialog.showOpenDialog({
              title: 'Select Repositories',
              properties: ['openDirectory', 'multiSelections'],
            })
      )

      if (selection.canceled || selection.filePaths.length === 0) return { status: 'cancelled' }
      return { status: 'created', snapshot: await authority.addWorkspaceRepositories(workspaceId, selection.filePaths) }
    }
  )
  handleTrustedIpc(
    applicationStateIpcChannels.removeWorkspaceRepository,
    (_event, workspaceId: unknown, membershipId: unknown) => {
      if (typeof workspaceId !== 'string' || typeof membershipId !== 'string') {
        throw new TypeError('A Workspace Repository is required.')
      }

      return authority.removeWorkspaceRepository(workspaceId, membershipId)
    }
  )
  handleTrustedIpc(
    applicationStateIpcChannels.updateWorkspaceMembership,
    (_event, workspaceId: unknown, membershipId: unknown, update: unknown) => {
      if (typeof workspaceId !== 'string' || typeof membershipId !== 'string' || !isWorkspaceMembershipUpdate(update)) {
        throw new TypeError('A Workspace Repository membership update is required.')
      }

      return authority.updateWorkspaceMembership(workspaceId, membershipId, update)
    }
  )
}

function isWorkspaceMembershipUpdate(value: unknown): value is WorkspaceMembershipUpdate {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { role?: unknown }).role === 'string' &&
    isStringArray((value as { relationships?: unknown }).relationships) &&
    isStringArray((value as { validationCommands?: unknown }).validationCommands)
  )
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}
