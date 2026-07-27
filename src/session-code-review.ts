export const maximumSessionCodeReviewComments = 50
export const maximumSessionCodeReviewCommentLength = 20_000
export const maximumSessionCodeReferencePatchLength = 50_000
export const maximumSessionCodeReviewLength = 200_000
const maximumSessionCodeReviewIdLength = 256
const maximumSessionCodeReviewRepositoryNameLength = 256
const maximumSessionCodeReviewPathLength = 8_192

export type SessionCodeReference = Readonly<{
  repositoryId: string
  repositoryName: string
  path: string
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  patch: string
  truncated?: boolean
}>

export type SessionCodeReviewComment = Readonly<{
  id: string
  text: string
  reference: SessionCodeReference
  createdAt: number
}>

export type SessionCodeReview = Readonly<{
  kind: 'follow-up' | 'review'
  comments: readonly SessionCodeReviewComment[]
}>

export type SessionCodeReviewDraft = Readonly<{
  comments: readonly SessionCodeReviewComment[]
}>

export type SessionCodeReviewCommentInput = Readonly<{
  commentId?: string
  text: string
  reference: SessionCodeReference
}>

export function boundSessionCodeReferencePatch(patch: string): Readonly<{ patch: string; truncated: boolean }> {
  if (patch.length <= maximumSessionCodeReferencePatchLength) return { patch, truncated: false }

  const marker = '\n… Referenced diff truncated.'
  return {
    patch: `${patch.slice(0, maximumSessionCodeReferencePatchLength - marker.length)}${marker}`,
    truncated: true,
  }
}

export type SessionCodeReviewRecord =
  | Readonly<{ type: 'code-review-comment'; comment: SessionCodeReviewComment }>
  | Readonly<{ type: 'code-review-comment-removed'; commentId: string }>
  | Readonly<{ type: 'code-review-comments-cleared'; commentIds: readonly string[] }>
  | Readonly<{
      type: 'code-review-message'
      review: SessionCodeReview
      text: string
      acceptedAt: number
    }>

export function projectSessionCodeReviewDraft(records: readonly SessionCodeReviewRecord[]): SessionCodeReviewDraft {
  const comments = new Map<string, SessionCodeReviewComment>()

  for (const record of records) {
    if (record.type === 'code-review-comment') comments.set(record.comment.id, record.comment)
    if (record.type === 'code-review-comment-removed') comments.delete(record.commentId)
    if (record.type === 'code-review-comments-cleared') {
      record.commentIds.forEach((commentId) => comments.delete(commentId))
    }
    if (record.type === 'code-review-message' && record.review.kind === 'review') {
      record.review.comments.forEach((comment) => comments.delete(comment.id))
    }
  }

  return { comments: [...comments.values()].sort((left, right) => left.createdAt - right.createdAt) }
}

export function parseSessionCodeReview(value: unknown): SessionCodeReview | undefined {
  if (!isRecord(value) || (value.kind !== 'follow-up' && value.kind !== 'review') || !Array.isArray(value.comments)) {
    return undefined
  }
  if (
    value.comments.length === 0 ||
    value.comments.length > maximumSessionCodeReviewComments ||
    (value.kind === 'follow-up' && value.comments.length !== 1)
  ) {
    return undefined
  }

  const comments = value.comments.map(parseSessionCodeReviewComment)
  if (comments.some((comment) => !comment)) return undefined

  const review: SessionCodeReview = { kind: value.kind, comments: comments as SessionCodeReviewComment[] }
  return formatSessionCodeReviewText(review).length <= maximumSessionCodeReviewLength ? review : undefined
}

export function parseSessionCodeReviewCommentInput(value: unknown): SessionCodeReviewCommentInput | undefined {
  if (!isRecord(value)) return undefined
  if (value.commentId !== undefined && !isBoundedString(value.commentId, maximumSessionCodeReviewIdLength)) {
    return undefined
  }
  if (!isReviewText(value.text)) return undefined

  const reference = parseSessionCodeReference(value.reference)
  if (!reference) return undefined

  return {
    commentId: value.commentId as string | undefined,
    text: value.text,
    reference,
  }
}

export function formatSessionCodeReviewText(
  review: SessionCodeReview,
  formatCommentText: (text: string, outputOffset: number) => string = (text) => text
): string {
  const fileCount = new Set(review.comments.map(({ reference }) => `${reference.repositoryId}\0${reference.path}`)).size
  const heading =
    review.kind === 'review'
      ? `Code review with ${review.comments.length} ${review.comments.length === 1 ? 'comment' : 'comments'} across ${fileCount} ${fileCount === 1 ? 'file' : 'files'}.`
      : 'Follow-up about a referenced code change.'
  let output = heading

  for (const comment of review.comments) {
    const reference = comment.reference
    const context = [
      `## ${reference.repositoryName} · ${reference.path} · ${formatLineRange(reference)}`,
      `~~~~diff\n${reference.patch}\n~~~~`,
    ].join('\n\n')

    output += `\n\n${context}\n\n`
    output += formatCommentText(comment.text, output.length)
  }

  return output
}

function formatLineRange(reference: SessionCodeReference): string {
  if (reference.newLines > 0) {
    const end = reference.newStart + reference.newLines - 1
    return `+${reference.newStart}${end === reference.newStart ? '' : `–${end}`}`
  }

  const end = reference.oldStart + Math.max(1, reference.oldLines) - 1
  return `-${reference.oldStart}${end === reference.oldStart ? '' : `–${end}`}`
}

function parseSessionCodeReviewComment(value: unknown): SessionCodeReviewComment | undefined {
  if (
    !isRecord(value) ||
    !isBoundedString(value.id, maximumSessionCodeReviewIdLength) ||
    !isReviewText(value.text) ||
    !isTimestamp(value.createdAt)
  ) {
    return undefined
  }

  const reference = parseSessionCodeReference(value.reference)
  if (!reference) return undefined

  return { id: value.id, text: value.text, reference, createdAt: value.createdAt }
}

function parseSessionCodeReference(value: unknown): SessionCodeReference | undefined {
  if (
    !isRecord(value) ||
    !isBoundedString(value.repositoryId, maximumSessionCodeReviewIdLength) ||
    !isBoundedString(value.repositoryName, maximumSessionCodeReviewRepositoryNameLength) ||
    !isSafeRelativePath(value.path) ||
    !isCount(value.oldStart) ||
    !isCount(value.oldLines) ||
    !isCount(value.newStart) ||
    !isCount(value.newLines) ||
    typeof value.patch !== 'string' ||
    value.patch.length === 0 ||
    value.patch.length > maximumSessionCodeReferencePatchLength ||
    (value.truncated !== undefined && typeof value.truncated !== 'boolean')
  ) {
    return undefined
  }

  return {
    repositoryId: value.repositoryId,
    repositoryName: value.repositoryName,
    path: value.path,
    oldStart: value.oldStart,
    oldLines: value.oldLines,
    newStart: value.newStart,
    newLines: value.newLines,
    patch: value.patch,
    ...(value.truncated === true ? { truncated: true } : {}),
  }
}

function isReviewText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maximumSessionCodeReviewCommentLength
}

function isSafeRelativePath(value: unknown): value is string {
  if (
    !isBoundedString(value, maximumSessionCodeReviewPathLength) ||
    value.startsWith('/') ||
    value.startsWith('\\') ||
    value.includes('\\') ||
    value.includes('\0')
  ) {
    return false
  }

  const parts = value.split('/')
  return parts.every((part) => part.length > 0 && part !== '.' && part !== '..')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isBoundedString(value: unknown, maximumLength: number): value is string {
  return isNonEmptyString(value) && value.length <= maximumLength
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function isTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}
