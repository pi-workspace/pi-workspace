import { useEffect, useState } from 'react'
import type { SessionId } from '@/src/domain/session'
import type { SessionConfigurationBridge, SessionConfigurationSnapshot } from '@/src/session-configuration'

export function useSessionConfiguration(sessionId: SessionId, bridge?: SessionConfigurationBridge) {
  const [snapshot, setSnapshot] = useState<SessionConfigurationSnapshot>()

  useEffect(() => {
    if (!bridge) return

    let active = true
    setSnapshot(undefined)

    void bridge.getSnapshot(sessionId).then((nextSnapshot) => {
      if (active) {
        setSnapshot((current) => (!current || nextSnapshot.revision >= current.revision ? nextSnapshot : current))
      }
    })

    const unsubscribe = bridge.subscribe(sessionId, (mutation) => {
      if (active) {
        setSnapshot((current) => (!current || mutation.revision >= current.revision ? mutation.snapshot : current))
      }
    })

    return () => {
      active = false
      unsubscribe()
    }
  }, [bridge, sessionId])

  return snapshot
}
