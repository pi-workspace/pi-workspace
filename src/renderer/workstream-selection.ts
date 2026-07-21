import type { SessionId } from '@/src/domain/session'

export type WorkstreamSelection = Readonly<{
  workstreamId?: string
  sessionId?: SessionId
}>

export type WorkstreamSelectionAction =
  | Readonly<{ type: 'start-workspace-load' }>
  | Readonly<{ type: 'select-workstream'; workstreamId: string }>
  | Readonly<{ type: 'select-session'; workstreamId: string; sessionId: SessionId }>

export const initialWorkstreamSelection: WorkstreamSelection = {}

export function updateWorkstreamSelection(
  _selection: WorkstreamSelection,
  action: WorkstreamSelectionAction
): WorkstreamSelection {
  if (action.type === 'start-workspace-load') return initialWorkstreamSelection
  if (action.type === 'select-workstream') return { workstreamId: action.workstreamId }

  return { workstreamId: action.workstreamId, sessionId: action.sessionId }
}
