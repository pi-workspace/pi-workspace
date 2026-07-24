import type { SessionMessageSubmissionResult } from '@/src/composer'

export type ComposerSubmissionState = Readonly<{
  draft: string
  awaiting: boolean
  error: string
  status: string
}>

export type ComposerSubmissionEvent =
  | Readonly<{ type: 'edit'; draft: string }>
  | Readonly<{ type: 'submit'; draft: string }>
  | Readonly<{
      type: 'resolve'
      submittedDraft: string
      result: SessionMessageSubmissionResult
    }>

export function getComposerSubmissionState(event: ComposerSubmissionEvent): ComposerSubmissionState {
  if (event.type === 'edit') {
    return { draft: event.draft, awaiting: false, error: '', status: '' }
  }

  if (event.type === 'submit') {
    return { draft: event.draft, awaiting: true, error: '', status: '' }
  }

  if (event.result.status === 'rejected') {
    const errors = {
      'invalid-submission': 'Message wasn’t sent because the request was invalid. Edit it and try again.',
      'session-unavailable': 'This Session is unavailable. Check its Repository and history, then try again.',
      'run-in-progress': 'This Session is already starting work. Wait a moment and try again.',
      'agent-run-capacity': 'Ten Agent Runs are already active. Wait for one to finish, then try again.',
      'follow-up-capacity':
        'This Session already has three queued follow-ups. Wait for Pi to process one, then try again.',
      'runtime-unavailable': 'Pi couldn’t open this Session. Check its Repository and history, then try again.',
      'skill-unavailable': 'That Skill is no longer available for this Session. Remove it and choose another.',
      'preflight-rejected': 'Pi couldn’t start this run. Check the selected Model and provider, then try again.',
      unexpected: 'Message wasn’t sent. Try again.',
    } as const

    return {
      draft: event.submittedDraft,
      awaiting: false,
      error: errors[event.result.reason],
      status: '',
    }
  }

  // The accepted message is already visible in the canonical transcript.
  return { draft: '', awaiting: false, error: '', status: '' }
}
