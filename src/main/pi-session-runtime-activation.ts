import type { SessionId } from '@/src/domain/session'

export type SessionRuntimeActivationGate = Readonly<{
  run<T>(sessionId: SessionId, action: () => Promise<T>): Promise<T>
  dispose(): void
}>

/** Serializes Session activation so configuration cannot race Agent Run acceptance. */
export function createSessionRuntimeActivationGate(): SessionRuntimeActivationGate {
  const tails = new Map<SessionId, Promise<void>>()

  return {
    async run<T>(sessionId: SessionId, action: () => Promise<T>): Promise<T> {
      const previous = tails.get(sessionId) ?? Promise.resolve()
      let release: () => void = () => {}
      const next = new Promise<void>((resolve) => {
        release = resolve
      })

      const tail = previous.then(() => next)
      tails.set(sessionId, tail)
      await previous

      try {
        return await action()
      } finally {
        release()

        if (tails.get(sessionId) === tail) tails.delete(sessionId)
      }
    },
    dispose() {
      tails.clear()
    },
  }
}
