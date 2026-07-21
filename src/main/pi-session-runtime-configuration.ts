import type { SessionId } from '@/src/domain/session'
import type {
  SessionConfigurationCommandResult,
  SessionConfigurationModelSelection,
  SessionConfigurationEffort,
  SessionConfigurationMutation,
  SessionConfigurationSnapshot,
} from '@/src/session-configuration'
import type { PiSessionRuntime } from './pi-session-runtimes'

type ConfigurationChange = (runtime: PiSessionRuntime) => Promise<void>
type PendingConfigurationChange = {
  apply: ConfigurationChange
  promise: Promise<SessionConfigurationCommandResult>
  resolve(result: SessionConfigurationCommandResult): void
  reject(error: unknown): void
}
type ConfigurationChangeSchedule = {
  pending?: PendingConfigurationChange
}

type SessionRuntimeConfigurationOptions = Readonly<{
  getRuntime: (sessionId: SessionId) => Promise<PiSessionRuntime | undefined>
  withActivationGate: <T>(sessionId: SessionId, action: () => Promise<T>) => Promise<T>
}>

export type SessionRuntimeConfiguration = Readonly<{
  getSnapshot(sessionId: SessionId): Promise<SessionConfigurationSnapshot>
  setModel(sessionId: SessionId, model: SessionConfigurationModelSelection): Promise<SessionConfigurationCommandResult>
  setEffort(sessionId: SessionId, effort: SessionConfigurationEffort): Promise<SessionConfigurationCommandResult>
  dismissWarning(sessionId: SessionId): Promise<SessionConfigurationSnapshot>
  subscribe(listener: (mutation: SessionConfigurationMutation) => void): () => void
  dispose(): void
}>

/** Owns revisioned Session Configuration snapshots and serialized configuration changes. */
export function createSessionRuntimeConfiguration({
  getRuntime,
  withActivationGate,
}: SessionRuntimeConfigurationOptions): SessionRuntimeConfiguration {
  const listeners = new Set<(mutation: SessionConfigurationMutation) => void>()
  const snapshots = new Map<SessionId, SessionConfigurationSnapshot>()
  const snapshotPromises = new Map<SessionId, Promise<SessionConfigurationSnapshot>>()
  const schedules = new Map<SessionId, ConfigurationChangeSchedule>()

  function publish(sessionId: SessionId, snapshot: SessionConfigurationSnapshot): SessionConfigurationSnapshot {
    const nextSnapshot = { ...snapshot, revision: snapshot.revision + 1 }
    snapshots.set(sessionId, nextSnapshot)
    listeners.forEach((listener) => listener({ sessionId, revision: nextSnapshot.revision, snapshot: nextSnapshot }))

    return nextSnapshot
  }

  async function loadSnapshot(sessionId: SessionId): Promise<SessionConfigurationSnapshot> {
    const runtime = await getRuntime(sessionId)

    if (!runtime?.getConfiguration) throw new Error('The Session configuration is unavailable.')

    const configuration = await runtime.getConfiguration()
    const existing = snapshots.get(sessionId)
    const snapshot: SessionConfigurationSnapshot = {
      ...configuration,
      sessionId,
      revision: existing?.revision ?? 0,
      persistenceWarning: existing?.persistenceWarning,
    }

    snapshots.set(sessionId, snapshot)
    return snapshot
  }

  function getSnapshot(sessionId: SessionId): Promise<SessionConfigurationSnapshot> {
    const existing = snapshotPromises.get(sessionId)
    if (existing) return existing

    const pending = loadSnapshot(sessionId).finally(() => {
      if (snapshotPromises.get(sessionId) === pending) snapshotPromises.delete(sessionId)
    })
    snapshotPromises.set(sessionId, pending)

    return pending
  }

  function changed(
    previous: SessionConfigurationSnapshot,
    next: Omit<SessionConfigurationSnapshot, 'sessionId' | 'revision' | 'persistenceWarning'>
  ): boolean {
    return (
      previous.model?.provider !== next.model?.provider ||
      previous.model?.id !== next.model?.id ||
      previous.effort !== next.effort
    )
  }

  async function applyChange(
    sessionId: SessionId,
    apply: ConfigurationChange
  ): Promise<SessionConfigurationCommandResult> {
    let previous: SessionConfigurationSnapshot | undefined
    let runtime: PiSessionRuntime | undefined
    let liveChange: Omit<SessionConfigurationSnapshot, 'sessionId' | 'revision' | 'persistenceWarning'> | undefined
    let rejection: unknown

    try {
      await withActivationGate(sessionId, async () => {
        previous = await getSnapshot(sessionId)
        runtime = await getRuntime(sessionId)

        if (!runtime || runtime.isStreaming || !runtime.getConfiguration) {
          throw new Error('Model and Effort can only change while the Session is idle.')
        }

        await apply(runtime)
        liveChange = await runtime.getConfiguration()
      })
    } catch (error) {
      rejection = error

      if (runtime?.getConfiguration && previous) {
        try {
          const current = await runtime.getConfiguration()
          if (changed(previous, current)) liveChange = current
        } catch {
          // Keep the last known effective selection when Pi cannot report state.
        }
      }
    }

    if (!previous) {
      const snapshot = await getSnapshot(sessionId)
      return { status: 'rejected', snapshot, message: 'The Session configuration could not be changed.' }
    }

    if (!liveChange) {
      return {
        status: 'rejected',
        snapshot: previous,
        message: rejection instanceof Error ? rejection.message : 'The Session configuration could not be changed.',
      }
    }

    let snapshot = publish(sessionId, {
      ...liveChange,
      sessionId,
      revision: previous.revision,
      persistenceWarning: undefined,
    })

    let persistenceErrors: readonly string[] | undefined

    try {
      persistenceErrors = await runtime?.flushConfiguration?.()
    } catch {
      persistenceErrors = ['Configuration persistence failed.']
    }

    if (persistenceErrors && persistenceErrors.length > 0) {
      snapshot = publish(sessionId, {
        ...snapshot,
        persistenceWarning:
          'This Session is using the selected Model and Effort, but the change may not survive reopening and the default for new Sessions may not have changed.',
      })
    }

    return { status: 'applied', snapshot }
  }

  function runChange(
    sessionId: SessionId,
    apply: ConfigurationChange,
    schedule: ConfigurationChangeSchedule
  ): Promise<SessionConfigurationCommandResult> {
    const result = applyChange(sessionId, apply)
    const advance = () => {
      const pending = schedule.pending
      schedule.pending = undefined

      if (!pending) {
        if (schedules.get(sessionId) === schedule) schedules.delete(sessionId)
        return
      }

      runChange(sessionId, pending.apply, schedule).then(pending.resolve, pending.reject)
    }

    void result.then(advance, advance)
    return result
  }

  function scheduleChange(
    sessionId: SessionId,
    apply: ConfigurationChange
  ): Promise<SessionConfigurationCommandResult> {
    const existing = schedules.get(sessionId)

    if (!existing) {
      const schedule: ConfigurationChangeSchedule = {}
      schedules.set(sessionId, schedule)
      return runChange(sessionId, apply, schedule)
    }

    if (existing.pending) {
      existing.pending.apply = apply
      return existing.pending.promise
    }

    let resolve: (result: SessionConfigurationCommandResult) => void = () => {}
    let reject: (error: unknown) => void = () => {}
    const promise = new Promise<SessionConfigurationCommandResult>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise
      reject = rejectPromise
    })
    existing.pending = { apply, promise, resolve, reject }

    return promise
  }

  return {
    getSnapshot,
    setModel(sessionId, model) {
      return scheduleChange(sessionId, async (runtime) => {
        if (!runtime.setConfigurationModel) throw new Error('Model selection is unavailable for this Session.')
        await runtime.setConfigurationModel(model)
      })
    },
    setEffort(sessionId, effort) {
      return scheduleChange(sessionId, async (runtime) => {
        if (!runtime.setConfigurationEffort) throw new Error('Effort selection is unavailable for this Session.')
        await runtime.setConfigurationEffort(effort)
      })
    },
    async dismissWarning(sessionId) {
      const snapshot = await getSnapshot(sessionId)
      return publish(sessionId, { ...snapshot, persistenceWarning: undefined })
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    dispose() {
      snapshots.clear()
      snapshotPromises.clear()
      schedules.clear()
      listeners.clear()
    },
  }
}
