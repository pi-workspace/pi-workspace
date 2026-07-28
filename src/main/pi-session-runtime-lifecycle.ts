import type { SessionId } from '@/src/domain/session'
import type { PiSessionLocation, PiSessionRuntime } from './pi-session-runtimes'

export type SessionRuntimeEntry = Readonly<{
  runtime: PiSessionRuntime
  runtimeKey?: string
  unsubscribes: readonly (() => void)[]
}>

type SessionRuntimeLifecycleOptions = Readonly<{
  findSession: (sessionId: SessionId) => PiSessionLocation | undefined | Promise<PiSessionLocation | undefined>
  createSession: (location: PiSessionLocation, sessionId: SessionId) => Promise<PiSessionRuntime>
  attach(
    sessionId: SessionId,
    runtimeDirectory: string,
    runtime: PiSessionRuntime,
    runtimeKey?: string
  ): SessionRuntimeEntry
}>

export type SessionRuntimeLifecycle = Readonly<{
  register(sessionId: SessionId, runtimeDirectory: string, runtime: PiSessionRuntime): void
  get(sessionId: SessionId): Promise<PiSessionRuntime | undefined>
  getEntry(sessionId: SessionId): Promise<SessionRuntimeEntry> | undefined
  retire(sessionId: SessionId, pendingEntry: Promise<SessionRuntimeEntry>): Promise<void>
  sessionIds(): IterableIterator<SessionId>
  dispose(): void
}>

/** Maintains one live Pi runtime per Session and owns replacement and cleanup. */
export function createSessionRuntimeLifecycle({
  findSession,
  createSession,
  attach,
}: SessionRuntimeLifecycleOptions): SessionRuntimeLifecycle {
  const entries = new Map<SessionId, Promise<SessionRuntimeEntry>>()
  const runtimeRequests = new Map<SessionId, Promise<PiSessionRuntime | undefined>>()

  async function retire(sessionId: SessionId, pendingEntry: Promise<SessionRuntimeEntry>): Promise<void> {
    try {
      const entry = await pendingEntry
      if (entries.get(sessionId) !== pendingEntry) return

      entry.unsubscribes.forEach((unsubscribe) => unsubscribe())
      void entry.runtime.abort?.().catch(() => {})
      entry.runtime.dispose()
      entries.delete(sessionId)
    } catch {
      entries.delete(sessionId)
    }
  }

  async function resolveRuntime(sessionId: SessionId): Promise<PiSessionRuntime | undefined> {
    const existingEntry = entries.get(sessionId)
    const existing = existingEntry ? await existingEntry : undefined

    if (existing?.runtime.isStreaming || (existing && existing.runtimeKey === undefined)) return existing.runtime

    const location = await findSession(sessionId)
    if (!location) return undefined
    if (existing && existing.runtimeKey === location.runtimeKey) return existing.runtime

    if (existing) {
      existing.unsubscribes.forEach((unsubscribe) => unsubscribe())
      existing.runtime.dispose()
      entries.delete(sessionId)
    }

    const pendingEntry = createSession(location, sessionId).then((runtime) =>
      attach(sessionId, location.directoryPath, runtime, location.runtimeKey)
    )
    entries.set(sessionId, pendingEntry)

    try {
      return (await pendingEntry).runtime
    } catch (error) {
      entries.delete(sessionId)
      throw error
    }
  }

  return {
    register(sessionId, runtimeDirectory, runtime) {
      if (entries.has(sessionId)) throw new Error('The Session runtime is already registered.')
      entries.set(sessionId, Promise.resolve(attach(sessionId, runtimeDirectory, runtime)))
    },
    get(sessionId) {
      const existingRequest = runtimeRequests.get(sessionId)
      if (existingRequest) return existingRequest

      const request = resolveRuntime(sessionId).finally(() => {
        if (runtimeRequests.get(sessionId) === request) runtimeRequests.delete(sessionId)
      })
      runtimeRequests.set(sessionId, request)

      return request
    },
    getEntry(sessionId) {
      return entries.get(sessionId)
    },
    retire,
    sessionIds() {
      return entries.keys()
    },
    dispose() {
      entries.forEach((pendingEntry) => {
        void pendingEntry
          .then(({ runtime, unsubscribes }) => {
            unsubscribes.forEach((unsubscribe) => unsubscribe())
            runtime.dispose()
          })
          .catch(() => {})
      })
      entries.clear()
      runtimeRequests.clear()
    },
  }
}
