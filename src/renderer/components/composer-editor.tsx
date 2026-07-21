import {
  $createLineBreakNode,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  COMMAND_PRIORITY_HIGH,
  KEY_ENTER_COMMAND,
  PASTE_COMMAND,
} from 'lexical'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
import { PlainTextPlugin } from '@lexical/react/LexicalPlainTextPlugin'
import { forwardRef, useEffect, useImperativeHandle } from 'react'
import type { SessionMessageDelivery } from '@/src/composer'

const externalDraftUpdateTag = 'composer-external-draft'
const htmlBlockNames = new Set(['ADDRESS', 'ARTICLE', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'P', 'PRE'])

export type ComposerEditorHandle = Readonly<{
  focus(): void
}>

type ComposerEditorProperties = Readonly<{
  describedBy: string
  draft: string
  label: string
  readOnly: boolean
  onChange: (draft: string) => void
  onFocus: () => void
  onSubmit: (delivery: SessionMessageDelivery) => void
}>

function replaceDraft(draft: string, selectEnd = false): void {
  const root = $getRoot()
  const paragraph = $createParagraphNode()
  const lines = draft.split('\n')

  lines.forEach((line, index) => {
    if (index > 0) {
      paragraph.append($createLineBreakNode())
    }

    if (line.length > 0) {
      paragraph.append($createTextNode(line))
    }
  })

  root.clear().append(paragraph)

  if (selectEnd) {
    paragraph.selectEnd()
  }
}

function getPlainClipboardText(clipboardData: DataTransfer): string {
  const plainText = clipboardData.getData('text/plain')

  if (plainText.length > 0) {
    return plainText
  }

  const html = clipboardData.getData('text/html')

  if (html.length === 0) {
    return ''
  }

  function getNodeText(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent ?? ''
    }

    if (node.nodeName === 'BR') {
      return '\n'
    }

    const childText = Array.from(node.childNodes, getNodeText).join('')
    return htmlBlockNames.has(node.nodeName) && childText.length > 0 && !childText.endsWith('\n')
      ? `${childText}\n`
      : childText
  }

  return getNodeText(new DOMParser().parseFromString(html, 'text/html').body).replace(/\n+$/, '')
}

function ComposerEditorPlugins({
  draft,
  readOnly,
  onChange,
  onSubmit,
  editorHandle,
}: Pick<ComposerEditorProperties, 'draft' | 'readOnly' | 'onChange' | 'onSubmit'> & {
  editorHandle: React.Ref<ComposerEditorHandle>
}) {
  const [editor] = useLexicalComposerContext()

  useImperativeHandle(editorHandle, () => ({
    focus() {
      editor.getRootElement()?.focus()
      editor.focus()
    },
  }))

  useEffect(() => {
    editor.setEditable(!readOnly)
  }, [editor, readOnly])

  useEffect(() => {
    editor.getEditorState().read(() => {
      if ($getRoot().getTextContent() === draft) {
        return
      }

      editor.update(() => replaceDraft(draft), { tag: externalDraftUpdateTag })
    })
  }, [draft, editor])

  useEffect(
    () =>
      editor.registerCommand(
        KEY_ENTER_COMMAND,
        (event) => {
          if (!event) {
            return false
          }

          if (event.isComposing || event.keyCode === 229) {
            return false
          }

          if (event.ctrlKey || event.metaKey) {
            return false
          }

          if (event.shiftKey) {
            event.preventDefault()
            editor.update(() => {
              const selection = $getSelection()

              if ($isRangeSelection(selection)) {
                selection.insertLineBreak()
                return
              }

              const lastNode = $getRoot().getLastChild()

              if ($isElementNode(lastNode)) {
                lastNode.append($createLineBreakNode()).selectEnd()
              }
            })
            return true
          }

          event.preventDefault()

          if (!event.repeat) {
            onSubmit(event.altKey ? 'follow-up' : 'steer')
          }

          return true
        },
        COMMAND_PRIORITY_HIGH
      ),
    [editor, onSubmit]
  )

  useEffect(
    () =>
      editor.registerCommand(
        PASTE_COMMAND,
        (event) => {
          if (!('clipboardData' in event)) {
            return false
          }

          const clipboardData = event.clipboardData

          if (!clipboardData) {
            return false
          }

          event.preventDefault()

          const plainText = getPlainClipboardText(clipboardData)

          editor.update(() => {
            const selection = $getSelection()

            if ($isRangeSelection(selection)) {
              selection.insertRawText(plainText)
              return
            }

            replaceDraft(`${$getRoot().getTextContent()}${plainText}`, true)
          })

          return true
        },
        COMMAND_PRIORITY_HIGH
      ),
    [editor]
  )

  useEffect(
    () =>
      editor.registerUpdateListener(({ editorState, tags }) => {
        if (tags.has(externalDraftUpdateTag)) {
          return
        }

        editorState.read(() => {
          const nextDraft = $getRoot().getTextContent()

          if (nextDraft !== draft) {
            onChange(nextDraft)
          }
        })
      }),
    [draft, editor, onChange]
  )

  return <HistoryPlugin />
}

export const ComposerEditor = forwardRef<ComposerEditorHandle, ComposerEditorProperties>(function ComposerEditor(
  { describedBy, draft, label, readOnly, onChange, onFocus, onSubmit },
  editorHandle
) {
  return (
    <LexicalComposer
      initialConfig={{
        namespace: `Composer:${label}`,
        editable: !readOnly,
        editorState: () => replaceDraft(draft, true),
        onError(error) {
          throw error
        },
        theme: {},
      }}
    >
      <div className="relative z-10 min-w-0">
        <PlainTextPlugin
          contentEditable={
            <ContentEditable
              aria-describedby={describedBy}
              aria-label={label}
              aria-multiline="true"
              className="composer-editable relative z-10 block min-h-6 w-full resize-none overflow-y-auto bg-transparent px-3.5 py-3.5 text-sm/6 text-composer-foreground outline-none"
              onFocus={onFocus}
              role="textbox"
              spellCheck
            />
          }
          placeholder={
            <div className="pointer-events-none absolute top-3.5 left-3.5 text-sm/6 text-composer-muted-foreground">
              Ask Pi…
            </div>
          }
          ErrorBoundary={LexicalErrorBoundary}
        />
        <ComposerEditorPlugins
          draft={draft}
          readOnly={readOnly}
          onChange={onChange}
          onSubmit={onSubmit}
          editorHandle={editorHandle}
        />
      </div>
    </LexicalComposer>
  )
})
