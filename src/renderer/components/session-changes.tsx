import { useCallback, useEffect, useId, useRef, useState } from 'react'
import {
  ChevronRight,
  CircleAlert,
  FileCode2,
  GitBranch,
  LoaderCircle,
  Pencil,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui-kit/button'
import { Checkbox } from '@/components/ui-kit/checkbox'
import type { SessionId } from '@/src/domain/session'
import type { SessionChangeFile, SessionChangesSnapshot, SessionFileDiff } from '@/src/session-changes'
import {
  boundSessionCodeReferencePatch,
  type SessionCodeReference,
  type SessionCodeReviewComment,
  type SessionCodeReviewDraft,
} from '@/src/session-code-review'
import { projectSessionSkillSelections, type SessionSkill } from '@/src/session-skills'
import { ComposerEditor, type ComposerEditorHandle } from './composer-editor'
import { DiffView, parseUnifiedDiffHunks, type DiffHunk } from './diff-view'
import { SkillMentionText } from './skill-mention-text'

export type SessionChangesSelection = Readonly<{
  repositoryId?: string
  path: string
  request: number
}>

type SessionChangesProperties = Readonly<{
  sessionId: SessionId
  selection?: SessionChangesSelection
}>

export function SessionChanges({ sessionId, selection }: SessionChangesProperties) {
  const [snapshot, setSnapshot] = useState<SessionChangesSnapshot>()
  const [snapshotRevision, setSnapshotRevision] = useState(0)
  const [error, setError] = useState<string>()
  const [expandedFiles, setExpandedFiles] = useState<ReadonlySet<string>>(new Set())
  const [stagingFile, setStagingFile] = useState<string>()
  const [stagingErrors, setStagingErrors] = useState<ReadonlyMap<string, string>>(new Map())
  const [announcement, setAnnouncement] = useState('')
  const [reviewDraft, setReviewDraft] = useState<SessionCodeReviewDraft>({ comments: [] })
  const [availableSkills, setAvailableSkills] = useState<readonly SessionSkill[]>([])
  const [reviewPending, setReviewPending] = useState(false)
  const [reviewError, setReviewError] = useState<string>()
  const [activeReviewFile, setActiveReviewFile] = useState<string>()
  const requestRef = useRef(0)
  const expandedFilesRef = useRef(expandedFiles)

  const applySnapshot = useCallback((next: SessionChangesSnapshot) => {
    const availableFiles = new Set(
      next.repositories.flatMap((repository) =>
        repository.files.map((file) => fileKey(repository.repositoryId, file.path))
      )
    )
    const missingFile = [...expandedFilesRef.current].find((key) => !availableFiles.has(key))

    if (missingFile) setAnnouncement(`${filePathFromKey(missingFile)} is no longer changed.`)

    setExpandedFiles((current) => new Set([...current].filter((key) => availableFiles.has(key))))
    setSnapshot(next)
    setSnapshotRevision((revision) => revision + 1)
  }, [])

  const refresh = useCallback(async () => {
    const request = ++requestRef.current
    setError(undefined)

    try {
      const next = await window.piWorkspace.sessionChanges.getSnapshot(sessionId)
      if (request !== requestRef.current) return

      applySnapshot(next)
    } catch (loadError) {
      if (request !== requestRef.current) return
      setError(loadError instanceof Error ? loadError.message : 'Changes are unavailable.')
    }
  }, [applySnapshot, sessionId])

  useEffect(() => {
    setSnapshot(undefined)
    setExpandedFiles(new Set())
    setStagingFile(undefined)
    setStagingErrors(new Map())
    void refresh()

    const unsubscribe = window.piWorkspace.transcript.subscribe((mutation) => {
      if (mutation.sessionId === sessionId) void refresh()
    })
    const handleFocus = () => void refresh()
    window.addEventListener('focus', handleFocus)

    return () => {
      requestRef.current += 1
      unsubscribe()
      window.removeEventListener('focus', handleFocus)
    }
  }, [refresh, sessionId])

  useEffect(() => {
    expandedFilesRef.current = expandedFiles
  }, [expandedFiles])

  useEffect(() => {
    let current = true
    setReviewDraft({ comments: [] })
    setAvailableSkills([])
    setReviewError(undefined)
    setActiveReviewFile(undefined)

    void window.piWorkspace.composer?.getCodeReviewDraft?.(sessionId).then(
      (draft) => {
        if (current) setReviewDraft(draft)
      },
      () => {
        if (current) setReviewError('Review comments could not be loaded.')
      }
    )
    void window.piWorkspace.sessionSkills?.getAvailable(sessionId).then(
      (skills) => {
        if (current) setAvailableSkills(skills)
      },
      () => {}
    )

    return () => {
      current = false
    }
  }, [sessionId])

  useEffect(() => {
    if (!selection || !snapshot) return

    for (const repository of snapshot.repositories) {
      if (selection.repositoryId && selection.repositoryId !== repository.repositoryId) continue
      const file = repository.files.find((candidate) => candidate.path === selection.path)
      if (!file) continue

      const key = fileKey(repository.repositoryId, file.path)
      setExpandedFiles((current) => new Set(current).add(key))
      return
    }
  }, [selection?.request, snapshot])

  const setFileStaged = async (repositoryId: string, file: SessionChangeFile, staged: boolean) => {
    const key = fileKey(repositoryId, file.path)
    setStagingFile(key)
    setStagingErrors((current) => {
      const next = new Map(current)
      next.delete(key)
      return next
    })

    try {
      const next = await window.piWorkspace.sessionChanges.setFileStaged(sessionId, repositoryId, file.path, staged)
      requestRef.current += 1
      applySnapshot(next)
      setAnnouncement(`${file.path} ${staged ? 'staged' : 'unstaged'}.`)
    } catch (stageError) {
      setStagingErrors((current) =>
        new Map(current).set(
          key,
          stageError instanceof Error ? stageError.message : `Could not ${staged ? 'stage' : 'unstage'} the file.`
        )
      )
    } finally {
      setStagingFile(undefined)
    }
  }

  const saveReviewComment = async (
    text: string,
    reference: SessionCodeReference,
    commentId?: string
  ): Promise<boolean> => {
    setReviewPending(true)
    setReviewError(undefined)

    try {
      const next = await window.piWorkspace.composer.saveCodeReviewComment({
        sessionId,
        commentId,
        text,
        reference,
      })
      setReviewDraft(next)
      setAnnouncement(commentId ? 'Review comment updated.' : 'Review comment added.')
      return true
    } catch (saveError) {
      setReviewError(saveError instanceof Error ? saveError.message : 'The review comment could not be saved.')
      return false
    } finally {
      setReviewPending(false)
    }
  }

  const removeReviewComment = async (commentId: string): Promise<void> => {
    setReviewPending(true)
    setReviewError(undefined)

    try {
      setReviewDraft(await window.piWorkspace.composer.removeCodeReviewComment(sessionId, commentId))
      setAnnouncement('Review comment removed.')
    } catch (removeError) {
      setReviewError(removeError instanceof Error ? removeError.message : 'The review comment could not be removed.')
    } finally {
      setReviewPending(false)
    }
  }

  const sendCodeFollowUp = async (text: string, reference: SessionCodeReference): Promise<boolean> => {
    setReviewPending(true)
    setReviewError(undefined)
    const comment = {
      id: `follow-up-${Date.now()}`,
      text,
      reference,
      createdAt: Date.now(),
    }

    try {
      const result = await window.piWorkspace.composer.submit({
        sessionId,
        text: '',
        delivery: 'follow-up',
        codeReview: { kind: 'follow-up', comments: [comment] },
      })
      if (result.status === 'rejected') {
        setReviewError('The referenced follow-up could not be sent.')
        return false
      }

      setAnnouncement('Referenced follow-up sent.')
      return true
    } catch {
      setReviewError('The referenced follow-up could not be sent.')
      return false
    } finally {
      setReviewPending(false)
    }
  }

  const finishReview = async () => {
    if (reviewDraft.comments.length === 0 || reviewPending) return

    setReviewPending(true)
    setReviewError(undefined)

    try {
      const result = await window.piWorkspace.composer.finishCodeReview(sessionId)
      if (result.status === 'rejected') {
        setReviewError('The code review could not be sent.')
        return
      }

      setReviewDraft({ comments: [] })
      setAnnouncement('Code review sent.')
    } catch {
      setReviewError('The code review could not be sent.')
    } finally {
      setReviewPending(false)
    }
  }

  const fileCount = snapshot?.repositories.reduce((count, repository) => count + repository.files.length, 0) ?? 0
  const currentFiles = new Set(
    snapshot?.repositories.flatMap((repository) =>
      repository.files.map((file) => fileKey(repository.repositoryId, file.path))
    ) ?? []
  )
  const detachedReviewComments = snapshot
    ? reviewDraft.comments.filter(({ reference }) => !currentFiles.has(fileKey(reference.repositoryId, reference.path)))
    : []

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-content-background">
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-content-border px-4">
        <div>
          <h2 className="text-sm/5 font-semibold text-content-foreground">Session changes</h2>
          <p className="text-xs/4 text-content-muted-foreground">
            {fileCount} changed {fileCount === 1 ? 'file' : 'files'}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {reviewDraft.comments.length > 0 && (
            <Button
              outline
              className="!px-2.5 !py-1.5 !text-xs/5"
              disabled={reviewPending}
              onClick={() => void finishReview()}
            >
              {reviewPending ? 'Sending review…' : `Finish review (${reviewDraft.comments.length})`}
            </Button>
          )}
          <Button
            plain
            aria-label="Refresh Session changes"
            disabled={Boolean(stagingFile)}
            onClick={() => void refresh()}
          >
            <RefreshCw aria-hidden="true" data-slot="icon" />
          </Button>
        </div>
      </header>
      {reviewError && (
        <p className="border-b border-content-border px-4 py-2 text-xs/5 text-form-error-foreground" role="alert">
          {reviewError}
        </p>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {detachedReviewComments.length > 0 && (
          <DetachedReviewComments
            availableSkills={availableSkills}
            comments={detachedReviewComments}
            pending={reviewPending}
            onRemove={removeReviewComment}
            onSave={saveReviewComment}
          />
        )}
        {!snapshot && !error ? (
          <ResourceMessage icon={LoaderCircle} message="Loading changes…" spinning />
        ) : error ? (
          <div className="p-5 text-center">
            <ResourceMessage icon={CircleAlert} message={error} />
            <Button className="mt-3" outline onClick={() => void refresh()}>
              Retry
            </Button>
          </div>
        ) : snapshot?.repositories.length === 0 ? (
          <ResourceMessage icon={GitBranch} message="No writable Repository has been prepared for this Session." />
        ) : fileCount === 0 ? (
          <ResourceMessage icon={GitBranch} message="This Session has no uncommitted changes." />
        ) : (
          snapshot?.repositories.map((repository) => (
            <section className="border-b border-content-border last:border-b-0" key={repository.repositoryId}>
              <div className="bg-content-subtle-background px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <GitBranch aria-hidden="true" className="size-3.5 text-content-muted-foreground" />
                  <h3 className="truncate text-xs/5 font-semibold text-content-foreground">
                    {repository.repositoryName}
                  </h3>
                </div>
                <p className="mt-0.5 truncate text-xs/4 text-content-muted-foreground">
                  {repository.branch.head}
                  {repository.branch.ahead > 0 ? ` · ${repository.branch.ahead} ahead` : ''}
                  {repository.branch.behind > 0 ? ` · ${repository.branch.behind} behind` : ''}
                </p>
                {repository.error && <p className="mt-1 text-xs/4 text-form-error-foreground">{repository.error}</p>}
              </div>
              <ul>
                {repository.files.map((file) => {
                  const key = fileKey(repository.repositoryId, file.path)
                  const expanded = expandedFiles.has(key)
                  const staging = stagingFile === key
                  const fullyStaged = file.staged && !file.unstaged
                  const partiallyStaged = file.staged && file.unstaged

                  return (
                    <li aria-busy={staging} className="border-t border-content-border first:border-t-0" key={file.path}>
                      <div className="flex min-w-0 items-center gap-2 px-2 py-1.5 hover:bg-content-interaction focus-within:bg-content-interaction">
                        <button
                          aria-expanded={expanded}
                          className="group flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left focus-visible:outline-2 focus-visible:outline-focus-ring"
                          onClick={() =>
                            setExpandedFiles((current) => {
                              const next = new Set(current)
                              if (expanded) next.delete(key)
                              else next.add(key)
                              return next
                            })
                          }
                          type="button"
                        >
                          <ChevronRight
                            aria-hidden="true"
                            className="size-3.5 shrink-0 text-content-muted-foreground transition-transform group-aria-expanded:rotate-90 motion-reduce:transition-none"
                          />
                          <FileCode2 aria-hidden="true" className="size-4 shrink-0 text-content-muted-foreground" />
                          <span className="min-w-0 flex-1 truncate text-xs/5 text-content-foreground" title={file.path}>
                            {file.path}
                          </span>
                          <span className="shrink-0 text-[10px]/4 font-medium uppercase text-content-muted-foreground">
                            {file.status === 'conflicted' ? 'Conflict' : file.status.slice(0, 1)}
                          </span>
                        </button>
                        {staging && (
                          <LoaderCircle
                            aria-label={`${fullyStaged ? 'Unstaging' : 'Staging'} ${file.path}`}
                            className="size-4 shrink-0 animate-spin text-content-muted-foreground motion-reduce:animate-none"
                          />
                        )}
                        <Checkbox
                          aria-label={
                            file.status === 'conflicted'
                              ? `Staging unavailable for conflicted file ${file.path}`
                              : `${fullyStaged ? 'Unstage' : 'Stage'} ${file.path}`
                          }
                          checked={file.staged}
                          disabled={Boolean(stagingFile) || file.status === 'conflicted'}
                          indeterminate={partiallyStaged}
                          onChange={() => void setFileStaged(repository.repositoryId, file, !fullyStaged)}
                          title={
                            file.status === 'conflicted' ? 'Resolve the conflict before staging this file.' : undefined
                          }
                        />
                      </div>
                      {stagingErrors.get(key) && (
                        <p className="px-4 pb-2 text-xs/5 text-form-error-foreground" role="alert">
                          {stagingErrors.get(key)}
                        </p>
                      )}
                      {expanded && (
                        <div className="border-t border-content-border bg-content-subtle-background p-3">
                          <InlineFileDiff
                            availableSkills={availableSkills}
                            editorActive={activeReviewFile === key}
                            file={file}
                            refreshRevision={snapshotRevision}
                            repositoryId={repository.repositoryId}
                            repositoryName={repository.repositoryName}
                            reviewComments={reviewDraft.comments.filter(
                              ({ reference }) =>
                                reference.repositoryId === repository.repositoryId && reference.path === file.path
                            )}
                            reviewPending={reviewPending}
                            sessionId={sessionId}
                            onActivateEditor={() => setActiveReviewFile(key)}
                            onFollowUp={sendCodeFollowUp}
                            onRemoveComment={removeReviewComment}
                            onSaveComment={saveReviewComment}
                          />
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            </section>
          ))
        )}
      </div>
      <p aria-live="polite" className="sr-only">
        {announcement || `${fileCount} changed files.`}
      </p>
    </div>
  )
}

function DetachedReviewComments({
  availableSkills,
  comments,
  pending,
  onRemove,
  onSave,
}: Readonly<{
  availableSkills: readonly SessionSkill[]
  comments: readonly SessionCodeReviewComment[]
  pending: boolean
  onRemove: (commentId: string) => Promise<void>
  onSave: (text: string, reference: SessionCodeReference, commentId?: string) => Promise<boolean>
}>) {
  const [editingCommentId, setEditingCommentId] = useState<string>()

  return (
    <section className="space-y-2 border-b border-content-border bg-content-subtle-background p-3">
      <div>
        <h3 className="text-xs/5 font-semibold text-content-foreground">Comments on earlier changes</h3>
        <p className="text-[10px]/4 text-content-muted-foreground">
          These files are no longer in the current Git changes.
        </p>
      </div>
      {comments.map((comment) => {
        const editing = editingCommentId === comment.id

        return (
          <div
            className="space-y-2 rounded-lg border border-content-border bg-content-background p-2.5"
            key={comment.id}
          >
            <div className="text-[10px]/4 text-content-muted-foreground">
              <p className="truncate font-medium text-content-foreground">{comment.reference.path}</p>
              <p className="truncate">
                {comment.reference.repositoryName} · {hunkLineRange(comment.reference)}
              </p>
            </div>
            <ReviewCommentCard
              availableSkills={availableSkills}
              comment={comment}
              disabled={pending}
              stale
              onEdit={() => setEditingCommentId(comment.id)}
              onRemove={() => {
                setEditingCommentId(undefined)
                void onRemove(comment.id)
              }}
            />
            <details>
              <summary className="w-fit cursor-pointer rounded text-xs/5 font-medium text-content-muted-foreground outline-none hover:text-content-foreground focus-visible:ring-2 focus-visible:ring-focus-ring">
                View referenced diff
              </summary>
              <div className="mt-2">
                <DiffView content={comment.reference.patch} label={`Referenced diff for ${comment.reference.path}`} />
              </div>
            </details>
            {editing && (
              <DiffMiniComposer
                availableSkills={availableSkills}
                draft={comment.text}
                label={`Edit comment on ${comment.reference.path}`}
                pending={pending}
                referenceLabel={`${comment.reference.path} · ${hunkLineRange(comment.reference)}`}
                submitLabel="Save"
                onCancel={() => setEditingCommentId(undefined)}
                onSubmit={async (text) => {
                  if (await onSave(text, comment.reference, comment.id)) setEditingCommentId(undefined)
                }}
              />
            )}
          </div>
        )
      })}
    </section>
  )
}

type HunkEditor = Readonly<{
  mode: 'comment' | 'follow-up'
  hunk: DiffHunk
  draft: string
  commentId?: string
}>

function InlineFileDiff({
  availableSkills,
  editorActive,
  file,
  refreshRevision,
  repositoryId,
  repositoryName,
  reviewComments,
  reviewPending,
  sessionId,
  onActivateEditor,
  onFollowUp,
  onRemoveComment,
  onSaveComment,
}: Readonly<{
  availableSkills: readonly SessionSkill[]
  editorActive: boolean
  file: SessionChangeFile
  refreshRevision: number
  repositoryId: string
  repositoryName: string
  reviewComments: readonly SessionCodeReviewComment[]
  reviewPending: boolean
  sessionId: SessionId
  onActivateEditor: () => void
  onFollowUp: (text: string, reference: SessionCodeReference) => Promise<boolean>
  onRemoveComment: (commentId: string) => Promise<void>
  onSaveComment: (text: string, reference: SessionCodeReference, commentId?: string) => Promise<boolean>
}>) {
  const [diff, setDiff] = useState<SessionFileDiff>()
  const [loading, setLoading] = useState(true)
  const [editor, setEditor] = useState<HunkEditor>()

  useEffect(() => {
    if (!editorActive) setEditor(undefined)
  }, [editorActive])

  useEffect(() => {
    let current = true
    setLoading(true)

    void window.piWorkspace.sessionChanges
      .loadFileDiff(sessionId, repositoryId, file.path, 'all')
      .then((next) => {
        if (current) setDiff(next)
      })
      .catch((loadError: unknown) => {
        if (!current) return
        setDiff({
          status: 'unavailable',
          message: loadError instanceof Error ? loadError.message : 'The diff is unavailable.',
        })
      })
      .finally(() => {
        if (current) setLoading(false)
      })

    return () => {
      current = false
    }
  }, [file.path, refreshRevision, repositoryId, sessionId])

  if (loading && !diff) return <ResourceMessage icon={LoaderCircle} message="Loading diff…" spinning />
  if (!diff?.content)
    return <ResourceMessage icon={CircleAlert} message={diff?.message ?? 'The diff is unavailable.'} />

  const referenceFor = (hunk: DiffHunk): SessionCodeReference => {
    const bounded = boundSessionCodeReferencePatch(hunk.patch)

    return {
      repositoryId,
      repositoryName,
      path: file.path,
      oldStart: hunk.oldStart,
      oldLines: hunk.oldLines,
      newStart: hunk.newStart,
      newLines: hunk.newLines,
      patch: bounded.patch,
      ...(bounded.truncated ? { truncated: true } : {}),
    }
  }
  const commentsFor = (hunk: DiffHunk) =>
    reviewComments.filter(
      ({ reference }) =>
        reference.oldStart === hunk.oldStart &&
        reference.oldLines === hunk.oldLines &&
        reference.newStart === hunk.newStart &&
        reference.newLines === hunk.newLines
    )
  const hunks = parseUnifiedDiffHunks(diff.content)
  const unanchoredComments = reviewComments.filter(
    (comment) => !hunks.some((hunk) => commentsFor(hunk).some((candidate) => candidate.id === comment.id))
  )

  return (
    <>
      {diff.message && <p className="mb-2 text-xs/5 text-content-muted-foreground">{diff.message}</p>}
      <DiffView
        content={diff.content}
        label={`Diff for ${file.path}`}
        onCommentHunk={(hunk) => {
          onActivateEditor()
          setEditor({ mode: 'comment', hunk, draft: '' })
        }}
        onFollowUpHunk={(hunk) => {
          onActivateEditor()
          setEditor({ mode: 'follow-up', hunk, draft: '' })
        }}
        renderHunkFooter={(hunk) => {
          const comments = commentsFor(hunk)
          const activeEditor = editor?.hunk.id === hunk.id ? editor : undefined
          if (comments.length === 0 && !activeEditor) return null

          return (
            <div className="space-y-2 p-2.5 font-sans">
              {comments.map((comment) => (
                <ReviewCommentCard
                  availableSkills={availableSkills}
                  comment={comment}
                  disabled={reviewPending}
                  key={comment.id}
                  stale={comment.reference.patch !== hunk.patch}
                  onEdit={() => {
                    onActivateEditor()
                    setEditor({
                      mode: 'comment',
                      hunk,
                      draft: comment.text,
                      commentId: comment.id,
                    })
                  }}
                  onRemove={() => void onRemoveComment(comment.id)}
                />
              ))}
              {activeEditor && (
                <DiffMiniComposer
                  availableSkills={availableSkills}
                  draft={activeEditor.draft}
                  label={`${activeEditor.mode === 'comment' ? 'Comment' : 'Follow up'} on ${file.path}`}
                  pending={reviewPending}
                  referenceLabel={`${file.path} · ${hunkLineRange(activeEditor.hunk)}`}
                  submitLabel={activeEditor.mode === 'comment' ? 'Comment' : 'Follow up'}
                  onCancel={() => setEditor(undefined)}
                  onSubmit={async (text) => {
                    const reference = referenceFor(activeEditor.hunk)
                    const accepted =
                      activeEditor.mode === 'comment'
                        ? await onSaveComment(text, reference, activeEditor.commentId)
                        : await onFollowUp(text, reference)
                    if (accepted) setEditor(undefined)
                  }}
                />
              )}
            </div>
          )
        }}
      />
      {unanchoredComments.length > 0 && (
        <div className="mt-2 space-y-2 rounded-lg border border-content-border bg-content-background p-2.5">
          <p className="text-xs/5 font-medium text-content-muted-foreground">Comments on an earlier diff</p>
          {unanchoredComments.map((comment) => (
            <ReviewCommentCard
              availableSkills={availableSkills}
              comment={comment}
              disabled={reviewPending}
              key={comment.id}
              stale
              onRemove={() => void onRemoveComment(comment.id)}
            />
          ))}
        </div>
      )}
    </>
  )
}

function ReviewCommentCard({
  availableSkills,
  comment,
  disabled,
  stale = false,
  onEdit,
  onRemove,
}: Readonly<{
  availableSkills: readonly SessionSkill[]
  comment: SessionCodeReviewComment
  disabled: boolean
  stale?: boolean
  onEdit?: () => void
  onRemove: () => void
}>) {
  const projected = projectSessionSkillSelections(comment.text)
  const skills = projected.selections.map(({ name, offset }) => {
    const available = availableSkills.find((skill) => skill.name === name)

    return {
      offset,
      skill: available
        ? { ...available, availability: 'available' as const }
        : { name, availability: 'unavailable' as const },
    }
  })

  return (
    <article className="rounded-md border border-content-border bg-content-subtle-background px-3 py-2 text-xs/5 text-content-foreground">
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 whitespace-pre-wrap break-words">
          <SkillMentionText skills={skills} text={projected.text} />
        </p>
        <div className="flex shrink-0 items-center gap-0.5">
          {onEdit && (
            <button
              type="button"
              aria-label="Edit review comment"
              className="rounded p-1 text-content-muted-foreground hover:bg-content-interaction hover:text-content-foreground focus-visible:outline-2 focus-visible:outline-focus-ring disabled:opacity-50"
              disabled={disabled}
              onClick={onEdit}
            >
              <Pencil aria-hidden="true" className="size-3.5" />
            </button>
          )}
          <button
            type="button"
            aria-label="Remove review comment"
            className="rounded p-1 text-content-muted-foreground hover:bg-content-interaction hover:text-content-foreground focus-visible:outline-2 focus-visible:outline-focus-ring disabled:opacity-50"
            disabled={disabled}
            onClick={onRemove}
          >
            <Trash2 aria-hidden="true" className="size-3.5" />
          </button>
        </div>
      </div>
      {stale && (
        <p className="mt-1.5 text-[10px]/4 text-content-muted-foreground">Code changed after this comment was added.</p>
      )}
      {comment.reference.truncated && (
        <p className="mt-1.5 text-[10px]/4 text-content-muted-foreground">Referenced diff was truncated.</p>
      )}
    </article>
  )
}

function DiffMiniComposer({
  availableSkills,
  draft: initialDraft,
  label,
  pending,
  referenceLabel,
  submitLabel,
  onCancel,
  onSubmit,
}: Readonly<{
  availableSkills: readonly SessionSkill[]
  draft: string
  label: string
  pending: boolean
  referenceLabel: string
  submitLabel: 'Comment' | 'Follow up' | 'Save'
  onCancel: () => void
  onSubmit: (text: string) => Promise<void>
}>) {
  const descriptionId = useId()
  const editorHandle = useRef<ComposerEditorHandle>(null)
  const [draft, setDraft] = useState(initialDraft)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => editorHandle.current?.focus(), [])

  const submit = async () => {
    const text = (editorHandle.current?.getDraft() ?? draft).trim()
    if (pending || submitting || text.length === 0) return

    setSubmitting(true)
    try {
      await onSubmit(text)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="rounded-lg border border-composer-border bg-composer-background shadow-sm">
      <div className="flex items-center gap-1.5 border-b border-composer-border px-3 py-1.5 text-[10px]/4 font-medium text-composer-muted-foreground">
        <FileCode2 aria-hidden="true" className="size-3" />
        <span className="truncate">{referenceLabel}</span>
      </div>
      <ComposerEditor
        ref={editorHandle}
        availableSkills={availableSkills}
        availableFiles={[]}
        describedBy={descriptionId}
        draft={draft}
        label={label}
        readOnly={pending || submitting}
        onChange={setDraft}
        onFocus={() => {}}
        onFileQuery={() => {}}
        onSubmit={() => void submit()}
      />
      <div className="flex items-center justify-end gap-1.5 border-t border-composer-border px-2.5 py-2">
        <button
          type="button"
          aria-label={`Cancel ${submitLabel.toLowerCase()}`}
          className="rounded-md p-1.5 text-composer-muted-foreground hover:bg-composer-interaction hover:text-composer-foreground focus-visible:outline-2 focus-visible:outline-focus-ring"
          disabled={pending || submitting}
          onClick={onCancel}
        >
          <X aria-hidden="true" className="size-3.5" />
        </button>
        <Button
          className="!px-2.5 !py-1.5 !text-xs/5"
          disabled={pending || submitting || draft.trim().length === 0}
          onClick={() => void submit()}
        >
          {submitting ? `${submitLabel}…` : submitLabel}
        </Button>
      </div>
      <p className="sr-only" id={descriptionId}>
        Enter to {submitLabel.toLowerCase()}. Shift+Enter for a new line. Skill references are available.
      </p>
    </div>
  )
}

function hunkLineRange(hunk: Readonly<Pick<DiffHunk, 'oldStart' | 'oldLines' | 'newStart' | 'newLines'>>): string {
  if (hunk.newLines > 0) {
    const end = hunk.newStart + hunk.newLines - 1
    return `+${hunk.newStart}${end === hunk.newStart ? '' : `–${end}`}`
  }

  const end = hunk.oldStart + Math.max(1, hunk.oldLines) - 1
  return `-${hunk.oldStart}${end === hunk.oldStart ? '' : `–${end}`}`
}

function fileKey(repositoryId: string, path: string): string {
  return `${repositoryId}\0${path}`
}

function filePathFromKey(key: string): string {
  return key.slice(key.indexOf('\0') + 1)
}

function ResourceMessage({
  icon: Icon,
  message,
  spinning = false,
}: Readonly<{ icon: typeof CircleAlert; message: string; spinning?: boolean }>) {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center gap-2 p-5 text-center text-xs/5 text-content-muted-foreground">
      <Icon aria-hidden="true" className={`size-5 ${spinning ? 'animate-spin motion-reduce:animate-none' : ''}`} />
      <p>{message}</p>
    </div>
  )
}
