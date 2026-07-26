import type { ActivityMutationPreview } from '@/src/session-timeline'

export type DiffViewProperties = Readonly<{
  content: string
  kind?: ActivityMutationPreview['kind']
  label?: string
}>

type DiffLine = Readonly<{
  text: string
  kind: 'addition' | 'deletion' | 'context' | 'meta'
  oldLine?: number
  newLine?: number
}>

export function DiffView({ content, kind = 'diff', label = 'Code preview' }: DiffViewProperties) {
  const lines = kind === 'diff' ? parseUnifiedDiff(content) : codeLines(content)

  return (
    <div
      aria-label={label}
      className="overflow-x-auto rounded-lg border border-content-border bg-session-message-code-background font-mono text-[11px]/5 text-session-message-code-foreground"
      role="region"
      tabIndex={0}
    >
      <table className="w-max min-w-full border-separate border-spacing-0">
        <tbody>
          {lines.map((line, index) => (
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
              key={`${index}-${line.text}`}
            >
              <td className="sticky left-0 w-10 select-none border-r border-content-border bg-content-background px-2 text-right text-content-muted-foreground">
                {line.oldLine}
              </td>
              <td className="sticky left-10 w-10 select-none border-r border-content-border bg-content-background px-2 text-right text-content-muted-foreground">
                {line.newLine}
              </td>
              <td
                className={`whitespace-pre px-3 ${
                  line.kind === 'addition'
                    ? 'text-diff-addition-foreground'
                    : line.kind === 'deletion'
                      ? 'text-diff-deletion-foreground'
                      : ''
                }`}
              >
                {line.text || ' '}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
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
