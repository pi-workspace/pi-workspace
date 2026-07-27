import type { ApplicationAuthority } from '@/src/main/application-state'
import { handleTrustedIpc } from '@/src/main/trusted-ipc'
import {
  parseCreateQuickSessionRequest,
  parseCreateSessionRequest,
  parseCreateWorkstreamRequest,
  parseForkSessionRequest,
  parsePreviewWorktreeLocationsRequest,
  parseRenameOwnedSessionRequest,
  parseSessionForkPointsRequest,
  parseShowWorkingLocationRequest,
  parseWorkstreamLifecycleRequest,
  workstreamsIpcChannels,
} from '@/src/workstreams-ipc'

let initialized = false

type WorkstreamsIpcOptions = Readonly<{
  openPath(path: string): Promise<string>
}>

export function initializeWorkstreams(authority: ApplicationAuthority, options: WorkstreamsIpcOptions): void {
  if (initialized) return

  initialized = true
  handleTrustedIpc(workstreamsIpcChannels.getSnapshot, (_event, workspaceId: unknown) => {
    return typeof workspaceId === 'string'
      ? authority.getWorkstreamSnapshot(workspaceId)
      : Promise.reject(new TypeError('A Workspace is required.'))
  })
  handleTrustedIpc(workstreamsIpcChannels.previewWorktreeLocations, (_event, value: unknown) => {
    const request = parsePreviewWorktreeLocationsRequest(value)

    return request
      ? authority.previewWorktreeLocations(request.workspaceId, request.repositoryId)
      : Promise.reject(new TypeError('A Workspace and selected Repository are required.'))
  })

  handleTrustedIpc(workstreamsIpcChannels.createWorkstream, (_event, value: unknown) => {
    const request = parseCreateWorkstreamRequest(value)

    return request
      ? authority.createWorkstream(request.workspaceId, request.options)
      : Promise.reject(new TypeError('A Workstream goal and at least one Repository are required.'))
  })
  handleTrustedIpc(workstreamsIpcChannels.createQuickSession, (_event, value: unknown) => {
    const request = parseCreateQuickSessionRequest(value)

    return request
      ? authority.createQuickSession(request.workspaceId, request.options)
      : Promise.reject(new TypeError('A Workspace Repository is required.'))
  })
  handleTrustedIpc(workstreamsIpcChannels.createSession, (_event, value: unknown) => {
    const request = parseCreateSessionRequest(value)

    return request
      ? authority.createWorkstreamSession(request.workstreamId, request.options)
      : Promise.reject(new TypeError('A Workstream is required.'))
  })
  handleTrustedIpc(workstreamsIpcChannels.getSessionForkPoints, (_event, value: unknown) => {
    const request = parseSessionForkPointsRequest(value)

    return request
      ? authority.getSessionForkPoints(request.sessionId)
      : Promise.reject(new TypeError('A Session is required.'))
  })
  handleTrustedIpc(workstreamsIpcChannels.forkSession, (_event, value: unknown) => {
    const request = parseForkSessionRequest(value)

    return request
      ? authority.forkSession(request.sessionId, request.options)
      : Promise.reject(new TypeError('A Session, user message, and title are required.'))
  })
  handleTrustedIpc(workstreamsIpcChannels.setLifecycle, (_event, value: unknown) => {
    const request = parseWorkstreamLifecycleRequest(value)

    return request
      ? authority.setWorkstreamLifecycle(request.workstreamId, request.lifecycle)
      : Promise.reject(new TypeError('A Workstream and lifecycle are required.'))
  })
  handleTrustedIpc(workstreamsIpcChannels.showWorkingLocation, async (_event, value: unknown) => {
    const request = parseShowWorkingLocationRequest(value)
    if (!request) throw new TypeError('A Workstream Repository working location is required.')

    const path = await authority.resolveWorkstreamWorkingLocation(request.workstreamId, request.repositoryId)
    const error = await options.openPath(path)
    if (error) throw new Error(error)
  })
  handleTrustedIpc(workstreamsIpcChannels.renameSession, (_event, value: unknown) => {
    const request = parseRenameOwnedSessionRequest(value)

    return request
      ? authority.renameWorkstreamSession(request.sessionId, request.title)
      : Promise.reject(new TypeError('A Session and title are required.'))
  })
}
