import type { SessionId } from '@/src/domain/session'
import type { QueuedFollowUp, QueuedFollowUpRecord } from '@/src/queued-follow-up'

export interface QueuedFollowUpQueue {
  hydrate(sessionId: SessionId, records: readonly QueuedFollowUpRecord[]): void
  enqueue(sessionId: SessionId, followUp: QueuedFollowUp): void
  remove(sessionId: SessionId, followUpId: string): QueuedFollowUp | undefined
  resume(sessionId: SessionId): boolean
  pause(sessionId: SessionId): void
  isPaused(sessionId: SessionId): boolean
  next(sessionId: SessionId): QueuedFollowUp | undefined
  queuedFollowUps(sessionId: SessionId): readonly QueuedFollowUp[]
  clear(): void
}

export function createQueuedFollowUpQueue(): QueuedFollowUpQueue {
  const queuedFollowUpsBySessionId = new Map<SessionId, QueuedFollowUp[]>()
  const hydratedSessionIds = new Set<SessionId>()
  const resumedSessionIds = new Set<SessionId>()

  return {
    hydrate(sessionId, records) {
      if (hydratedSessionIds.has(sessionId)) return

      hydratedSessionIds.add(sessionId)
      const queuedFollowUps = new Map<string, QueuedFollowUp>()

      for (const record of records) {
        if (record.type === 'queued-follow-up') queuedFollowUps.set(record.followUp.id, record.followUp)
        if (record.type === 'queued-follow-up-removed') queuedFollowUps.delete(record.followUpId)
      }

      queuedFollowUpsBySessionId.set(sessionId, [...queuedFollowUps.values()])
    },
    enqueue(sessionId, followUp) {
      const queue = queuedFollowUpsBySessionId.get(sessionId) ?? []

      queuedFollowUpsBySessionId.set(sessionId, [...queue, followUp])
      if (queue.length === 0) resumedSessionIds.add(sessionId)
    },
    remove(sessionId, followUpId) {
      const queue = queuedFollowUpsBySessionId.get(sessionId) ?? []
      const followUp = queue.find((candidate) => candidate.id === followUpId)

      if (!followUp) return undefined

      queuedFollowUpsBySessionId.set(
        sessionId,
        queue.filter((candidate) => candidate.id !== followUpId)
      )
      return followUp
    },
    resume(sessionId) {
      if ((queuedFollowUpsBySessionId.get(sessionId)?.length ?? 0) === 0) return false

      resumedSessionIds.add(sessionId)
      return true
    },
    pause(sessionId) {
      resumedSessionIds.delete(sessionId)
    },
    isPaused(sessionId) {
      return (queuedFollowUpsBySessionId.get(sessionId)?.length ?? 0) > 0 && !resumedSessionIds.has(sessionId)
    },
    next(sessionId) {
      return resumedSessionIds.has(sessionId) ? queuedFollowUpsBySessionId.get(sessionId)?.[0] : undefined
    },
    queuedFollowUps(sessionId) {
      return queuedFollowUpsBySessionId.get(sessionId) ?? []
    },
    clear() {
      queuedFollowUpsBySessionId.clear()
      hydratedSessionIds.clear()
      resumedSessionIds.clear()
    },
  }
}
