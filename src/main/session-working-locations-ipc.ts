import type { ApplicationAuthority } from '@/src/main/application-state'
import { broadcastToTrustedRenderers, handleTrustedIpc } from '@/src/main/trusted-ipc'
import {
  parseSessionBranchRequest,
  parseSessionWorkingLocationRequest,
  sessionWorkingLocationsIpcChannels,
} from '@/src/session-working-locations-ipc'

let initialized = false

export function initializeSessionWorkingLocations(authority: ApplicationAuthority): void {
  if (initialized) return
  initialized = true

  handleTrustedIpc(sessionWorkingLocationsIpcChannels.get, (_event, value: unknown) => {
    const request = parseSessionWorkingLocationRequest(value)
    return request && !request.repositoryId
      ? authority.getSessionWorkingLocations(request.sessionId)
      : Promise.reject(new TypeError('A Session is required.'))
  })

  handleTrustedIpc(sessionWorkingLocationsIpcChannels.getBranches, (_event, value: unknown) => {
    const request = parseSessionBranchRequest(value)
    if (!request || request.branchRef) throw new TypeError('A Quick Session Repository is required.')

    return authority.getSessionBranches(request.sessionId, request.repositoryId, request.refresh ?? false)
  })

  handleTrustedIpc(sessionWorkingLocationsIpcChannels.switchBranch, async (_event, value: unknown) => {
    const request = parseSessionBranchRequest(value)
    if (!request?.branchRef) throw new TypeError('A Quick Session Repository and branch are required.')

    const snapshot = await authority.switchQuickSessionBranch(
      request.sessionId,
      request.repositoryId,
      request.branchRef
    )
    broadcastToTrustedRenderers(sessionWorkingLocationsIpcChannels.changed)
    return snapshot
  })

  handleTrustedIpc(sessionWorkingLocationsIpcChannels.createWorktree, async (_event, value: unknown) => {
    const request = parseSessionWorkingLocationRequest(value)
    if (!request?.repositoryId) throw new TypeError('A Session and Repository are required.')

    await authority.createSessionWorktree(request.sessionId, request.repositoryId)
    const snapshot = await authority.getSessionWorkingLocations(request.sessionId)
    broadcastToTrustedRenderers(sessionWorkingLocationsIpcChannels.changed)
    return snapshot
  })
}
