import type { OwnedSession } from '@/src/domain/workstream'

export type SessionUnavailability = 'history' | 'checkout' | 'history-and-checkout'

export function getSessionUnavailability(session: OwnedSession): SessionUnavailability | undefined {
  const historyUnavailable = session.availability === 'unavailable'
  const checkoutUnavailable =
    session.repositoryAccess.kind === 'direct' && session.repositoryAccess.availability === 'unavailable'

  if (historyUnavailable && checkoutUnavailable) return 'history-and-checkout'
  if (historyUnavailable) return 'history'
  if (checkoutUnavailable) return 'checkout'

  return undefined
}

export function sessionUnavailabilityContext(session: OwnedSession): string | undefined {
  const unavailability = getSessionUnavailability(session)

  if (unavailability === 'history-and-checkout') return 'Session history and Repository checkout unavailable'
  if (unavailability === 'history') return 'Session history unavailable'
  if (unavailability === 'checkout') return 'Repository checkout unavailable'

  return undefined
}
