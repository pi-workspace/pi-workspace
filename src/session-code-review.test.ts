import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  boundSessionCodeReferencePatch,
  formatSessionCodeReviewText,
  maximumSessionCodeReferencePatchLength,
  parseSessionCodeReview,
  projectSessionCodeReviewDraft,
  type SessionCodeReview,
} from './session-code-review'

const review: SessionCodeReview = {
  kind: 'review',
  comments: [
    {
      id: 'comment-1',
      text: '/skill:tdd Keep the previous diff visible while refreshing.',
      createdAt: 1,
      reference: {
        repositoryId: 'repository-1',
        repositoryName: 'Pi Workspace',
        path: 'src/renderer/components/session-changes.tsx',
        oldStart: 184,
        oldLines: 3,
        newStart: 184,
        newLines: 4,
        patch: '@@ -184,3 +184,4 @@\n const diff = current\n+setRefreshing(true)',
      },
    },
  ],
}

describe('Session code reviews', () => {
  test('parses a bounded structured review and formats model-readable referenced context', () => {
    assert.deepEqual(parseSessionCodeReview(review), review)

    assert.equal(
      formatSessionCodeReviewText(review),
      'Code review with 1 comment across 1 file.\n\n' +
        '## Pi Workspace · src/renderer/components/session-changes.tsx · +184–187\n\n' +
        '~~~~diff\n' +
        '@@ -184,3 +184,4 @@\n const diff = current\n+setRefreshing(true)\n' +
        '~~~~\n\n' +
        '/skill:tdd Keep the previous diff visible while refreshing.'
    )
  })

  test('restores the latest unfinished comments from append-only records', () => {
    assert.deepEqual(
      projectSessionCodeReviewDraft([
        { type: 'code-review-comment', comment: review.comments[0]! },
        {
          type: 'code-review-comment',
          comment: { ...review.comments[0]!, text: 'Updated comment' },
        },
        { type: 'code-review-comments-cleared', commentIds: ['comment-1'] },
        {
          type: 'code-review-comment',
          comment: { ...review.comments[0]!, id: 'comment-2', text: 'Still pending' },
        },
      ]),
      { comments: [{ ...review.comments[0]!, id: 'comment-2', text: 'Still pending' }] }
    )
  })

  test('does not restore comments already included in an accepted review message', () => {
    assert.deepEqual(
      projectSessionCodeReviewDraft([
        { type: 'code-review-comment', comment: review.comments[0]! },
        {
          type: 'code-review-message',
          review,
          text: formatSessionCodeReviewText(review),
          acceptedAt: 2,
        },
      ]),
      { comments: [] }
    )
  })

  test('rejects a follow-up containing more than one referenced comment', () => {
    assert.equal(
      parseSessionCodeReview({ ...review, kind: 'follow-up', comments: [...review.comments, ...review.comments] }),
      undefined
    )
  })

  test('creates an explicitly truncated immutable snapshot for an oversized hunk', () => {
    const bounded = boundSessionCodeReferencePatch('x'.repeat(maximumSessionCodeReferencePatchLength + 1))

    assert.equal(bounded.patch.length, maximumSessionCodeReferencePatchLength)
    assert.equal(bounded.truncated, true)
    assert.match(bounded.patch, /Referenced diff truncated\.$/)
  })

  test('rejects unsafe Repository-relative paths and oversized patches', () => {
    assert.equal(
      parseSessionCodeReview({
        ...review,
        comments: [
          {
            ...review.comments[0],
            reference: { ...review.comments[0]!.reference, path: '../outside.ts' },
          },
        ],
      }),
      undefined
    )

    assert.equal(
      parseSessionCodeReview({
        ...review,
        comments: [
          {
            ...review.comments[0],
            reference: { ...review.comments[0]!.reference, patch: 'x'.repeat(50_001) },
          },
        ],
      }),
      undefined
    )
  })
})
