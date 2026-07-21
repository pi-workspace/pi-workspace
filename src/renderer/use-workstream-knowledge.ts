import { useEffect, useState } from 'react'
import type { Workstream } from '@/src/domain/workstream'
import type { WorkstreamKnowledge } from '@/src/domain/workstream-knowledge-transitions'

export type WorkstreamKnowledgeResource =
  | Readonly<{ status: 'not-applicable' }>
  | Readonly<{ status: 'loading'; workstreamId: string }>
  | Readonly<{ status: 'loaded'; workstreamId: string; knowledge: WorkstreamKnowledge }>
  | Readonly<{ status: 'failed'; workstreamId: string; message: string }>

export function useWorkstreamKnowledge(workstream: Workstream | undefined): WorkstreamKnowledgeResource {
  const [resource, setResource] = useState<WorkstreamKnowledgeResource>({ status: 'not-applicable' })
  const applicableWorkstreamId = workstream?.goal ? workstream.id : undefined

  useEffect(() => {
    if (!applicableWorkstreamId) {
      setResource({ status: 'not-applicable' })
      return
    }

    let active = true
    let latestRevision = -1
    const applyState = (knowledge: WorkstreamKnowledge) => {
      if (!active || knowledge.workstreamId !== applicableWorkstreamId || knowledge.knowledgeRevision < latestRevision)
        return

      latestRevision = knowledge.knowledgeRevision
      setResource({ status: 'loaded', workstreamId: applicableWorkstreamId, knowledge })
    }

    setResource({ status: 'loading', workstreamId: applicableWorkstreamId })
    const unsubscribe = window.piWorkspace.workstreamKnowledge.subscribe(applyState)
    void window.piWorkspace.workstreamKnowledge.get(applicableWorkstreamId).then(applyState, (error: unknown) => {
      if (!active || latestRevision >= 0) return

      const message = error instanceof Error ? error.message : 'Workstream knowledge is unavailable.'
      setResource({ status: 'failed', workstreamId: applicableWorkstreamId, message })
    })

    return () => {
      active = false
      unsubscribe()
    }
  }, [applicableWorkstreamId])

  if (!applicableWorkstreamId) return { status: 'not-applicable' }
  if ('workstreamId' in resource && resource.workstreamId === applicableWorkstreamId) return resource

  return { status: 'loading', workstreamId: applicableWorkstreamId }
}
