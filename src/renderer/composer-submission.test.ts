import assert from 'node:assert/strict'
import test from 'node:test'
import { getComposerSubmissionState } from './composer-submission'

test('accepted submission clears the exact submitted draft at preflight acceptance', () => {
  assert.deepEqual(
    getComposerSubmissionState({
      type: 'resolve',
      submittedDraft: '  Exact draft  ',
      result: { status: 'accepted', delivery: 'prompt' },
    }),
    { draft: '', awaiting: false, error: '', status: '' }
  )
})

test('rejected submission restores the exact submitted draft with an error', () => {
  assert.deepEqual(
    getComposerSubmissionState({
      type: 'resolve',
      submittedDraft: '  Exact draft  ',
      result: { status: 'rejected', reason: 'unexpected' },
    }),
    {
      draft: '  Exact draft  ',
      awaiting: false,
      error: 'Message wasn’t sent. Try again.',
      status: '',
    }
  )
})

test('rejected submission gives focused provider guidance without exposing runtime details', () => {
  assert.deepEqual(
    getComposerSubmissionState({
      type: 'resolve',
      submittedDraft: 'Keep this draft',
      result: { status: 'rejected', reason: 'preflight-rejected' },
    }),
    {
      draft: 'Keep this draft',
      awaiting: false,
      error: 'Pi couldn’t start this run. Check the selected Model and provider, then try again.',
      status: '',
    }
  )
})
