import {
  createWorkstreamKnowledgeIpcHandlers,
  workstreamKnowledgeIpcChannels,
  type WorkstreamKnowledgeAuthority,
} from '@/src/workstream-knowledge-ipc'
import { broadcastToTrustedRenderers, handleTrustedIpc } from '@/src/main/trusted-ipc'

let initialized = false

export function initializeWorkstreamKnowledge(authority: WorkstreamKnowledgeAuthority): void {
  if (initialized) return

  initialized = true
  const handlers = createWorkstreamKnowledgeIpcHandlers(authority)
  handleTrustedIpc(workstreamKnowledgeIpcChannels.get, (_event, workstreamId: unknown) => handlers.get(workstreamId))
  handleTrustedIpc(workstreamKnowledgeIpcChannels.mutate, (_event, workstreamId: unknown, value: unknown) =>
    handlers.mutate(workstreamId, value)
  )
  authority.subscribeWorkstreamKnowledge((state) => {
    broadcastToTrustedRenderers(workstreamKnowledgeIpcChannels.changed, state)
  })
}
