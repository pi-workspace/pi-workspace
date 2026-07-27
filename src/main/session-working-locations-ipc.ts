import type { ApplicationAuthority } from '@/src/main/application-state'
import { handleTrustedIpc } from '@/src/main/trusted-ipc'
import {
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

  handleTrustedIpc(sessionWorkingLocationsIpcChannels.createWorktree, async (_event, value: unknown) => {
    const request = parseSessionWorkingLocationRequest(value)
    if (!request?.repositoryId) throw new TypeError('A Session and Repository are required.')

    await authority.createSessionWorktree(request.sessionId, request.repositoryId)
    return authority.getSessionWorkingLocations(request.sessionId)
  })
}
