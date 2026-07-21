import type { SessionConfigurationEffort, SessionConfigurationModelSelection } from '@/src/session-configuration'
import { sessionConfigurationEfforts } from '@/src/session-configuration'
import { isSessionId, type SessionId } from '@/src/domain/session'

export const sessionConfigurationIpcChannels = {
  getSnapshot: 'session-configuration:get-snapshot',
  setModel: 'session-configuration:set-model',
  setEffort: 'session-configuration:set-effort',
  dismissWarning: 'session-configuration:dismiss-warning',
  changed: (sessionId: SessionId) => `session-configuration:changed:${sessionId}`,
} as const

export function parseSessionConfigurationRequest(value: unknown): { sessionId: string } | undefined {
  if (typeof value !== 'object' || value === null || !isSessionId((value as { sessionId?: unknown }).sessionId))
    return undefined

  return { sessionId: (value as { sessionId: string }).sessionId }
}

export function parseModelSelection(
  value: unknown
): Readonly<{ sessionId: string; model: SessionConfigurationModelSelection }> | undefined {
  if (typeof value !== 'object' || value === null) return undefined

  const request = value as { sessionId?: unknown; model?: { provider?: unknown; id?: unknown } }

  if (
    !isSessionId(request.sessionId) ||
    typeof request.model?.provider !== 'string' ||
    request.model.provider.length === 0 ||
    typeof request.model.id !== 'string' ||
    request.model.id.length === 0
  ) {
    return undefined
  }

  return { sessionId: request.sessionId, model: { provider: request.model.provider, id: request.model.id } }
}

export function parseEffortSelection(
  value: unknown
): Readonly<{ sessionId: string; effort: SessionConfigurationEffort }> | undefined {
  if (typeof value !== 'object' || value === null) return undefined

  const request = value as { sessionId?: unknown; effort?: unknown }

  if (
    !isSessionId(request.sessionId) ||
    !sessionConfigurationEfforts.includes(request.effort as SessionConfigurationEffort)
  ) {
    return undefined
  }

  return { sessionId: request.sessionId, effort: request.effort as SessionConfigurationEffort }
}
