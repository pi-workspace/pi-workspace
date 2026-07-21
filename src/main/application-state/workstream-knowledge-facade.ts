import type { SessionId } from '@/src/domain/session'
import type {
  WorkstreamKnowledge,
  WorkstreamKnowledgeCommand,
  WorkstreamKnowledgeMutationResult,
} from '@/src/domain/workstream-knowledge-transitions'
import { applyStoredWorkstreamKnowledgeCommand, readWorkstreamKnowledge } from './workstream-knowledge-store'
import type { SqliteDatabase } from './sqlite'

type WorkstreamKnowledgeFacadeOptions = Readonly<{
  openDatabase: () => SqliteDatabase
}>

export function createWorkstreamKnowledgeFacade({ openDatabase }: WorkstreamKnowledgeFacadeOptions) {
  const listeners = new Set<(knowledge: WorkstreamKnowledge) => void>()

  async function getWorkstreamKnowledge(workstreamId: string): Promise<WorkstreamKnowledge> {
    const database = openDatabase()

    try {
      return readWorkstreamKnowledge(database, workstreamId)
    } finally {
      database.close()
    }
  }

  async function applyUserWorkstreamKnowledgeCommand(
    workstreamId: string,
    command: WorkstreamKnowledgeCommand
  ): Promise<WorkstreamKnowledgeMutationResult> {
    return applyCommand(workstreamId, command, { actor: 'user', at: Date.now() })
  }

  async function applyPiWorkstreamKnowledgeCommand(
    workstreamId: string,
    command: WorkstreamKnowledgeCommand,
    sessionId: SessionId
  ): Promise<WorkstreamKnowledgeMutationResult> {
    return applyCommand(workstreamId, command, { actor: 'pi', at: Date.now(), sessionId })
  }

  function applyCommand(
    workstreamId: string,
    command: WorkstreamKnowledgeCommand,
    context: Readonly<{ actor: 'user' | 'pi'; at: number; sessionId?: SessionId }>
  ): WorkstreamKnowledgeMutationResult {
    const database = openDatabase()
    let result: WorkstreamKnowledgeMutationResult

    try {
      result = applyStoredWorkstreamKnowledgeCommand(database, workstreamId, command, context)
    } finally {
      database.close()
    }

    for (const listener of listeners) {
      try {
        listener(result.knowledge)
      } catch (error) {
        console.error('Unable to publish Workstream knowledge.', error)
      }
    }

    return result
  }

  function subscribeWorkstreamKnowledge(listener: (knowledge: WorkstreamKnowledge) => void): () => void {
    listeners.add(listener)

    return () => listeners.delete(listener)
  }

  return {
    getWorkstreamKnowledge,
    applyUserWorkstreamKnowledgeCommand,
    applyPiWorkstreamKnowledgeCommand,
    subscribeWorkstreamKnowledge,
  }
}
