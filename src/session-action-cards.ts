import type { SessionId } from '@/src/domain/session'

export const sessionActionKinds = ['start-implement-session', 'prepare-pull-request'] as const
export type SessionActionKind = (typeof sessionActionKinds)[number]

export const sessionActionCardStatuses = ['available', 'accepted', 'dismissed'] as const
export type SessionActionCardStatus = (typeof sessionActionCardStatuses)[number]

export type SessionActionCard = Readonly<{
  id: string
  sessionId: SessionId
  kind: SessionActionKind
  title: string
  description: string
  status: 'available' | 'accepted' | 'dismissed'
  createdAt: number
}>

export type SessionActionCardToolInput = Readonly<{
  kind: SessionActionKind
  title: string
  description: string
}>

export function isSessionActionKind(value: unknown): value is SessionActionKind {
  return typeof value === 'string' && sessionActionKinds.includes(value as SessionActionKind)
}

export function parseSessionActionCardToolInput(value: unknown): SessionActionCardToolInput | undefined {
  if (typeof value !== 'object' || value === null) return undefined

  const input = value as Record<string, unknown>
  if (!isSessionActionKind(input.kind)) return undefined
  if (typeof input.title !== 'string' || !input.title.trim()) return undefined
  if (typeof input.description !== 'string' || !input.description.trim()) return undefined

  return {
    kind: input.kind,
    title: input.title.trim(),
    description: input.description.trim(),
  }
}
