import type { SessionId } from '@/src/domain/session'

export type SessionPinningState = Readonly<{
  pinnedSessionIds: readonly SessionId[]
}>

export type SessionPinningAction = Readonly<{ type: 'toggle-pin'; sessionId: SessionId }> | Readonly<{ type: 'reset' }>

export function updateSessionPinning(state: SessionPinningState, action: SessionPinningAction): SessionPinningState {
  if (action.type === 'reset') return { pinnedSessionIds: [] }

  if (state.pinnedSessionIds.includes(action.sessionId)) {
    return {
      pinnedSessionIds: state.pinnedSessionIds.filter((sessionId) => sessionId !== action.sessionId),
    }
  }

  return {
    pinnedSessionIds: [...state.pinnedSessionIds, action.sessionId],
  }
}

export function getVisibleSessionIds(state: SessionPinningState, activeSessionId?: SessionId): readonly SessionId[] {
  if (!activeSessionId || state.pinnedSessionIds.includes(activeSessionId)) {
    return activeSessionId ? state.pinnedSessionIds : []
  }

  return [...state.pinnedSessionIds, activeSessionId]
}
