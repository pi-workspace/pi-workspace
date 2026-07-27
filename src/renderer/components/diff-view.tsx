import type { ReactNode } from 'react'
import { MessageSquarePlus, Send } from 'lucide-react'
import type { ActivityMutationPreview } from '@/src/session-timeline'

export type DiffHunk = Readonly<{
  id: string
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  patch: string
}>

export type DiffViewProperties = Readonly<{
  content: string
  kind?: ActivityMutationPreview['kind']
  label?: string
  onCommentHunk?: (hunk: DiffHunk) => void
  onFollowUpHunk?: (hunk: DiffHunk) => void
  renderHunkFooter?: (hunk: DiffHunk) => ReactNode
}>

type DiffLine = Readonly<{
  text: string
  kind: 'addition' | 'deletion' | 'context' | 'meta'
  oldLine?: number
  newLine?: number
}>

export function DiffView({
  content,
  kind = 'diff',
  label = 'Code preview',
  onCommentHunk,
  onFollowUpHunk,
  renderHunkFooter,
}: DiffViewProperties) {
  const sections = kind === 'diff' ? parseUnifiedDiffSections(content) : [{ lines: codeLines(content) }]
  const interactive = Boolean(onCommentHunk || onFollowUpHunk || renderHunkFooter)

  return (
    <div
      aria-label={label}
      className="overflow-hidden rounded-lg border border-content-border bg-session-message-code-background font-mono text-[11px]/5 text-session-message-code-foreground"
      role="region"
      tabIndex={0}
    >
      <table className="w-full table-fixed border-separate border-spacing-0">
        {sections.map((section, sectionIndex) => (
          <tbody className={section.hunk ? 'group/hunk' : undefined} key={section.hunk?.id ?? `meta-${sectionIndex}`}>
            {section.lines.map((line, lineIndex) => (
              <DiffTableRow
                actions={
                  interactive && section.hunk && lineIndex === 0 ? (
                    <span className="ml-auto flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover/hunk:opacity-100 group-focus-within/hunk:opacity-100 motion-reduce:transition-none">
                      {onCommentHunk && (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-sans text-[10px]/4 font-medium text-content-foreground hover:bg-content-interaction focus-visible:outline-2 focus-visible:outline-focus-ring"
                          onClick={() => onCommentHunk(section.hunk!)}
                        >
                          <MessageSquarePlus aria-hidden="true" className="size-3" />
                          Comment
                        </button>
                      )}
                      {onFollowUpHunk && (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-sans text-[10px]/4 font-medium text-content-foreground hover:bg-content-interaction focus-visible:outline-2 focus-visible:outline-focus-ring"
                          onClick={() => onFollowUpHunk(section.hunk!)}
                        >
                          <Send aria-hidden="true" className="size-3" />
                          Follow up
                        </button>
                      )}
                    </span>
                  ) : undefined
                }
                key={`${lineIndex}-${line.text}`}
                line={line}
              />
            ))}
            {section.hunk && renderHunkFooter ? (
              <DiffHunkFooterRow hunk={section.hunk} render={renderHunkFooter} />
            ) : null}
          </tbody>
        ))}
      </table>
    </div>
  )
}

function DiffHunkFooterRow({ hunk, render }: Readonly<{ hunk: DiffHunk; render: (hunk: DiffHunk) => ReactNode }>) {
  const content = render(hunk)
  if (!content) return null

  return (
    <tr>
      <td className="border-t border-content-border bg-content-background p-0" colSpan={3}>
        {content}
      </td>
    </tr>
  )
}

function DiffTableRow({ line, actions }: Readonly<{ line: DiffLine; actions?: ReactNode }>) {
  return (
    <tr
      className={
        line.kind === 'addition'
          ? 'bg-diff-addition-background'
          : line.kind === 'deletion'
            ? 'bg-diff-deletion-background'
            : line.kind === 'meta'
              ? 'text-content-muted-foreground'
              : undefined
      }
    >
      <td className="w-10 select-none border-r border-content-border bg-content-background px-2 text-right align-top text-content-muted-foreground">
        {line.oldLine}
      </td>
      <td className="w-10 select-none border-r border-content-border bg-content-background px-2 text-right align-top text-content-muted-foreground">
        {line.newLine}
      </td>
      <td
        className={`break-words whitespace-pre-wrap px-3 align-top ${
          line.kind === 'addition'
            ? 'text-diff-addition-foreground'
            : line.kind === 'deletion'
              ? 'text-diff-deletion-foreground'
              : ''
        }`}
      >
        <span className="flex min-w-0 items-start gap-2">
          <span className="min-w-0 flex-1">{line.text || ' '}</span>
          {actions}
        </span>
      </td>
    </tr>
  )
}

type DiffSection = Readonly<{
  hunk?: DiffHunk
  lines: readonly DiffLine[]
}>

export function parseUnifiedDiffHunks(content: string): readonly DiffHunk[] {
  return parseUnifiedDiffSections(content).flatMap((section) => (section.hunk ? [section.hunk] : []))
}

function parseUnifiedDiffSections(content: string): readonly DiffSection[] {
  const sourceLines = content.split('\n')
  const headerIndexes = sourceLines.flatMap((line, index) => (line.startsWith('@@ ') ? [index] : []))
  if (headerIndexes.length === 0) return [{ lines: parseUnifiedDiff(content) }]

  const sections: DiffSection[] = []
  const firstHeader = headerIndexes[0]!
  if (firstHeader > 0) sections.push({ lines: parseUnifiedDiff(sourceLines.slice(0, firstHeader).join('\n')) })

  headerIndexes.forEach((startIndex, index) => {
    const endIndex = headerIndexes[index + 1] ?? sourceLines.length
    const patch = sourceLines.slice(startIndex, endIndex).join('\n')
    const header = sourceLines[startIndex]?.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/)
    if (!header) return

    sections.push({
      hunk: {
        id: `${header[1]}:${header[3]}:${index}`,
        oldStart: Number(header[1]),
        oldLines: Number(header[2] ?? 1),
        newStart: Number(header[3]),
        newLines: Number(header[4] ?? 1),
        patch,
      },
      lines: parseUnifiedDiff(patch),
    })
  })

  return sections
}

function codeLines(content: string): readonly DiffLine[] {
  return content.split('\n').map((text, index) => ({ text, kind: 'context', newLine: index + 1 }))
}

export function parseUnifiedDiff(content: string): readonly DiffLine[] {
  let oldLine: number | undefined
  let newLine: number | undefined

  return content.split('\n').map((text): DiffLine => {
    const header = text.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
    if (header) {
      oldLine = Number(header[1])
      newLine = Number(header[2])
      return { text, kind: 'meta' }
    }
    if (text.startsWith('diff ') || text.startsWith('index ') || text.startsWith('---') || text.startsWith('+++')) {
      return { text, kind: 'meta' }
    }
    if (text.startsWith('+')) {
      const line = { text, kind: 'addition' as const, newLine }
      if (newLine !== undefined) newLine += 1
      return line
    }
    if (text.startsWith('-')) {
      const line = { text, kind: 'deletion' as const, oldLine }
      if (oldLine !== undefined) oldLine += 1
      return line
    }

    const line = { text, kind: 'context' as const, oldLine, newLine }
    if (oldLine !== undefined) oldLine += 1
    if (newLine !== undefined) newLine += 1
    return line
  })
}
