import type { SessionSkillMention } from '@/src/session-skills'
import type { SessionCodeReview } from '@/src/session-code-review'
import type { SessionFileMention } from '@/src/session-files'

export type QueuedFollowUp = Readonly<{
  id: string
  text: string
  sourceText?: string
  skills?: readonly SessionSkillMention[]
  files?: readonly SessionFileMention[]
  codeReview?: SessionCodeReview
  createdAt: number
}>

export type QueuedFollowUpRecord =
  | Readonly<{ type: 'queued-follow-up'; followUp: QueuedFollowUp }>
  | Readonly<{ type: 'queued-follow-up-removed'; followUpId: string }>
