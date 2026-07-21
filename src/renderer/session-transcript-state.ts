import { useCallback, useEffect, useRef, useState } from 'react'
import type { SessionId } from '@/src/domain/session'
import type { SessionWorkingStateSnapshot } from '@/src/session-timeline'
import type { SessionTranscriptMutation, SessionTranscriptSnapshot } from '@/src/session-transcript'

export type WorkingSessionProjection = Readonly<{
  revisions: ReadonlyMap<SessionId, number>
  workingSessionIds: ReadonlySet<SessionId>
}>

export const initialWorkingSessionProjection: WorkingSessionProjection = {
  revisions: new Map(),
  workingSessionIds: new Set(),
}

export function newestTranscriptMutation(
  current: SessionTranscriptMutation,
  candidate: SessionTranscriptMutation
): SessionTranscriptMutation {
  if (candidate.revision > current.revision) return candidate
  if (candidate.revision < current.revision) return current

  return candidate.announcement ? candidate : current
}

export function projectWorkingSessionSnapshot(
  current: WorkingSessionProjection,
  trackedSessionIds: ReadonlySet<SessionId>,
  snapshot: SessionWorkingStateSnapshot
): WorkingSessionProjection {
  if (!trackedSessionIds.has(snapshot.sessionId)) return current

  const currentRevision = current.revisions.get(snapshot.sessionId)
  if (currentRevision !== undefined && snapshot.revision < currentRevision) return current

  const revisions = new Map(current.revisions)
  revisions.set(snapshot.sessionId, snapshot.revision)

  const workingSessionIds = new Set(current.workingSessionIds)
  if (snapshot.isWorking) workingSessionIds.add(snapshot.sessionId)
  else workingSessionIds.delete(snapshot.sessionId)

  return { revisions, workingSessionIds }
}

function filterWorkingSessionProjection(
  current: WorkingSessionProjection,
  trackedSessionIds: ReadonlySet<SessionId>
): WorkingSessionProjection {
  return {
    revisions: new Map([...current.revisions].filter(([sessionId]) => trackedSessionIds.has(sessionId))),
    workingSessionIds: new Set([...current.workingSessionIds].filter((sessionId) => trackedSessionIds.has(sessionId))),
  }
}

export function useWorkingSessionIds(
  workspaceId: string | undefined,
  sessionIds: readonly SessionId[]
): ReadonlySet<SessionId> {
  const [workingSessionIds, setWorkingSessionIds] = useState<ReadonlySet<SessionId>>(new Set())
  const sessionIdsRef = useRef(sessionIds)
  const workspaceIdRef = useRef(workspaceId)
  const projection = useRef<WorkingSessionProjection>(initialWorkingSessionProjection)
  const sessionIdsKey = sessionIds.join('\u0000')
  sessionIdsRef.current = sessionIds

  useEffect(() => {
    const trackedSessionIds = new Set(sessionIdsRef.current)
    const workspaceChanged = workspaceIdRef.current !== workspaceId
    workspaceIdRef.current = workspaceId
    projection.current = workspaceChanged
      ? initialWorkingSessionProjection
      : filterWorkingSessionProjection(projection.current, trackedSessionIds)
    setWorkingSessionIds(projection.current.workingSessionIds)

    if (!workspaceId || trackedSessionIds.size === 0) return

    let active = true

    const applySnapshot = (snapshot: SessionWorkingStateSnapshot) => {
      if (!active) return

      const next = projectWorkingSessionSnapshot(projection.current, trackedSessionIds, snapshot)
      if (next === projection.current) return

      projection.current = next
      setWorkingSessionIds(next.workingSessionIds)
    }

    const transcript = window.piWorkspace.transcript
    if (!transcript) return

    const unsubscribe = transcript.subscribe((mutation) => applySnapshot(mutation.snapshot))

    void transcript
      .getWorkingStateSnapshots()
      .then((snapshots) => snapshots.forEach(applySnapshot))
      .catch(() => {})

    return () => {
      active = false
      unsubscribe()
    }
  }, [sessionIdsKey, workspaceId])

  return workingSessionIds
}

export function useSessionTranscript(sessionId: SessionId): Readonly<{
  snapshot?: SessionTranscriptSnapshot
  announcement?: string
  loading: boolean
  error?: string
  reload: () => void
}> {
  const [reloadKey, setReloadKey] = useState(0)
  const [state, setState] = useState<
    Readonly<{
      snapshot?: SessionTranscriptSnapshot
      announcement?: string
      loading: boolean
      error?: string
    }>
  >({ loading: true })

  const reload = useCallback(() => setReloadKey((key) => key + 1), [])

  useEffect(() => {
    let active = true
    let snapshotLoaded = false
    const pendingMutations: SessionTranscriptMutation[] = []

    setState((current) => ({ ...current, loading: true, error: undefined }))

    const applyMutation = (mutation: SessionTranscriptMutation) => {
      if (mutation.sessionId !== sessionId) return
      if (!snapshotLoaded) {
        pendingMutations.push(mutation)
        return
      }

      setState((current) =>
        !current.snapshot || mutation.revision > current.snapshot.revision
          ? { snapshot: mutation.snapshot, announcement: mutation.announcement, loading: false }
          : current
      )
    }

    const unsubscribe = window.piWorkspace.transcript?.subscribe(applyMutation) ?? (() => {})
    void window.piWorkspace.transcript
      ?.getSnapshot(sessionId)
      .then((snapshot) => {
        if (!active) return
        snapshotLoaded = true
        const latest = pendingMutations.reduce<SessionTranscriptMutation | undefined>(
          (current, mutation) => (current ? newestTranscriptMutation(current, mutation) : mutation),
          undefined
        )
        const nextSnapshot = latest && latest.revision >= snapshot.revision ? latest.snapshot : snapshot
        const nextAnnouncement = latest && latest.revision >= snapshot.revision ? latest.announcement : undefined

        setState({ snapshot: nextSnapshot, announcement: nextAnnouncement, loading: false })
      })
      .catch(() => {
        if (active) setState((current) => ({ ...current, loading: false, error: 'Unable to load Session transcript.' }))
      })

    return () => {
      active = false
      unsubscribe()
    }
  }, [reloadKey, sessionId])

  return { ...state, reload }
}

/* Session transcript is the only renderer transcript state and revision stream. */
