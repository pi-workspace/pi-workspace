import type { SessionId } from '@/src/domain/session'
import type {
  CreateQuickSessionOptions,
  CreateSessionOptions,
  CreateWorkstreamOptions,
  WorkstreamLifecycle,
  WorkstreamsSnapshot,
  WorktreeLocationsPreview,
} from '@/src/domain/workstream'

export type WorkstreamCreationOutcome = Readonly<{
  status: 'available' | 'pending' | 'quarantined'
  sessionId: SessionId
  snapshot: WorkstreamsSnapshot
}>

export interface WorkstreamsBridge {
  getSnapshot(workspaceId: string): Promise<WorkstreamsSnapshot>
  previewWorktreeLocations(workspaceId: string, repositoryId: string): Promise<WorktreeLocationsPreview>
  createWorkstream(workspaceId: string, options: CreateWorkstreamOptions): Promise<WorkstreamCreationOutcome>
  createQuickSession(workspaceId: string, options: CreateQuickSessionOptions): Promise<WorkstreamCreationOutcome>
  createSession(workstreamId: string, options: CreateSessionOptions): Promise<WorkstreamCreationOutcome>
  setLifecycle(workstreamId: string, lifecycle: WorkstreamLifecycle): Promise<WorkstreamsSnapshot>
  renameSession(sessionId: SessionId, title: string): Promise<WorkstreamsSnapshot>
  showWorkingLocation(workstreamId: string, repositoryId: string): Promise<void>
  subscribe(listener: (snapshot: WorkstreamsSnapshot) => void): () => void
}
