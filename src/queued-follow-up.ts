import type { SessionSkillMention } from '@/src/session-skills'
import type { SessionCodeReview } from '@/src/session-code-review'

export type QueuedFollowUp = Readonly<{
  id: string
  text: string
  skills?: readonly SessionSkillMention[]
  codeReview?: SessionCodeReview
  createdAt: number
}>

export type QueuedFollowUpRecord =
  | Readonly<{ type: 'queued-follow-up'; followUp: QueuedFollowUp }>
  | Readonly<{ type: 'queued-follow-up-removed'; followUpId: string }>
