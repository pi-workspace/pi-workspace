import type { SessionId } from '@/src/domain/session'

export const sessionConfigurationEfforts = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

export type SessionConfigurationEffort = (typeof sessionConfigurationEfforts)[number]

export type SessionConfigurationModel = Readonly<{
  provider: string
  providerName: string
  id: string
  name: string
}>

export type SessionConfigurationModelSelection = Readonly<{
  provider: string
  id: string
}>

export type SessionConfigurationSnapshot = Readonly<{
  sessionId: SessionId
  revision: number
  models: readonly SessionConfigurationModel[]
  model?: SessionConfigurationModelSelection
  effort: SessionConfigurationEffort
  supportedEfforts: readonly SessionConfigurationEffort[]
  persistenceWarning?: string
}>

export type SessionConfigurationMutation = Readonly<{
  sessionId: SessionId
  revision: number
  snapshot: SessionConfigurationSnapshot
}>

export type SessionConfigurationCommandResult =
  | Readonly<{ status: 'applied'; snapshot: SessionConfigurationSnapshot }>
  | Readonly<{ status: 'rejected'; snapshot: SessionConfigurationSnapshot; message: string }>

export type SessionConfigurationBridge = Readonly<{
  getSnapshot(sessionId: SessionId): Promise<SessionConfigurationSnapshot>
  setModel(sessionId: SessionId, model: SessionConfigurationModelSelection): Promise<SessionConfigurationCommandResult>
  setEffort(sessionId: SessionId, effort: SessionConfigurationEffort): Promise<SessionConfigurationCommandResult>
  dismissWarning(sessionId: SessionId): Promise<SessionConfigurationSnapshot>
  subscribe(sessionId: SessionId, listener: (mutation: SessionConfigurationMutation) => void): () => void
}>
