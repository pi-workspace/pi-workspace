import type { SessionSkillMention } from '@/src/session-skills'

export type QueuedFollowUp = Readonly<{
  id: string
  text: string
  skills?: readonly SessionSkillMention[]
  createdAt: number
}>

export type QueuedFollowUpRecord =
  | Readonly<{ type: 'queued-follow-up'; followUp: QueuedFollowUp }>
  | Readonly<{ type: 'queued-follow-up-removed'; followUpId: string }>
