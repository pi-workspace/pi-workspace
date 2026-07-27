import type { SessionCodeReviewCommentCommand } from '@/src/composer'
import type { SessionId } from '@/src/domain/session'
import type { ActivityLayerRecord } from '@/src/main/activity-records'
import {
  maximumSessionCodeReviewComments,
  parseSessionCodeReview,
  parseSessionCodeReviewCommentInput,
  projectSessionCodeReviewDraft,
  type SessionCodeReviewDraft,
  type SessionCodeReviewRecord,
} from '@/src/session-code-review'

type SessionRuntimeCodeReviewOptions = Readonly<{
  createId: () => string
  now: () => number
  persist: (sessionId: SessionId, record: ActivityLayerRecord) => boolean
}>

export interface SessionRuntimeCodeReviews {
  hydrate(sessionId: SessionId, records: readonly ActivityLayerRecord[]): void
  get(sessionId: SessionId): SessionCodeReviewDraft
  save(command: SessionCodeReviewCommentCommand): SessionCodeReviewDraft
  remove(sessionId: SessionId, commentId: string): SessionCodeReviewDraft
  clear(sessionId: SessionId, commentIds: readonly string[]): boolean
  dispose(): void
}

/** Owns persisted, unfinished code-review comments for Session runtimes. */
export function createSessionRuntimeCodeReviews({
  createId,
  now,
  persist,
}: SessionRuntimeCodeReviewOptions): SessionRuntimeCodeReviews {
  const draftsBySessionId = new Map<SessionId, SessionCodeReviewDraft>()

  function get(sessionId: SessionId): SessionCodeReviewDraft {
    return draftsBySessionId.get(sessionId) ?? { comments: [] }
  }

  return {
    hydrate(sessionId, activityRecords) {
      const records = activityRecords.flatMap((record): SessionCodeReviewRecord[] => {
        if (
          record.type === 'code-review-comment' ||
          record.type === 'code-review-comment-removed' ||
          record.type === 'code-review-comments-cleared' ||
          record.type === 'code-review-message'
        ) {
          return [record]
        }
        if (record.type === 'queued-follow-up' && record.followUp.codeReview?.kind === 'review') {
          return [
            {
              type: 'code-review-comments-cleared',
              commentIds: record.followUp.codeReview.comments.map(({ id }) => id),
            },
          ]
        }

        return []
      })

      draftsBySessionId.set(sessionId, projectSessionCodeReviewDraft(records))
    },
    get,
    save(command) {
      const input = parseSessionCodeReviewCommentInput(command)
      if (!input) throw new TypeError('A valid code-review comment is required.')

      const current = get(command.sessionId)
      const existing = input.commentId ? current.comments.find((comment) => comment.id === input.commentId) : undefined
      if (input.commentId && !existing) throw new Error('That review comment is no longer available.')
      if (!existing && current.comments.length >= maximumSessionCodeReviewComments) {
        throw new Error('Finish the current review before adding more comments.')
      }

      const comment = {
        id: existing?.id ?? createId(),
        text: input.text,
        reference: input.reference,
        createdAt: existing?.createdAt ?? now(),
      }
      const comments = existing
        ? current.comments.map((candidate) => (candidate.id === existing.id ? comment : candidate))
        : [...current.comments, comment]
      if (!parseSessionCodeReview({ kind: 'review', comments })) {
        throw new Error('This review is too large. Finish it before adding more comments.')
      }
      if (!persist(command.sessionId, { version: 1, type: 'code-review-comment', comment })) {
        throw new Error('The review comment could not be saved.')
      }

      const next = { comments }
      draftsBySessionId.set(command.sessionId, next)
      return next
    },
    remove(sessionId, commentId) {
      const current = get(sessionId)
      if (!current.comments.some((comment) => comment.id === commentId)) return current
      if (!persist(sessionId, { version: 1, type: 'code-review-comment-removed', commentId })) {
        throw new Error('The review comment could not be removed.')
      }

      const next = { comments: current.comments.filter((comment) => comment.id !== commentId) }
      draftsBySessionId.set(sessionId, next)
      return next
    },
    clear(sessionId, commentIds) {
      if (commentIds.length === 0) return true

      const persisted = persist(sessionId, { version: 1, type: 'code-review-comments-cleared', commentIds })
      const cleared = new Set(commentIds)
      draftsBySessionId.set(sessionId, {
        comments: get(sessionId).comments.filter((comment) => !cleared.has(comment.id)),
      })

      return persisted
    },
    dispose() {
      draftsBySessionId.clear()
    },
  }
}
