import {
  $createLineBreakNode,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  $nodesOfType,
  COMMAND_PRIORITY_CRITICAL,
  COMMAND_PRIORITY_HIGH,
  CONTROLLED_TEXT_INSERTION_COMMAND,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_BACKSPACE_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  KEY_TAB_COMMAND,
  PASTE_COMMAND,
  TextNode,
  type LexicalEditor,
} from 'lexical'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
import { PlainTextPlugin } from '@lexical/react/LexicalPlainTextPlugin'
import { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useMemo, useState } from 'react'
import type { SessionMessageDelivery } from '@/src/composer'
import {
  $createComposerSkillNode,
  $getComposerSkillNode,
  $isComposerSkillNode,
  ComposerSkillNode,
  removeComposerSkillCommand,
} from '@/src/renderer/components/composer-skill-node'
import { projectSessionSkillSelections, type SessionSkill, type SessionSkillReference } from '@/src/session-skills'

const externalDraftUpdateTag = 'composer-external-draft'
const composerCaretMarker = '\u00a0'
const htmlBlockNames = new Set(['ADDRESS', 'ARTICLE', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'P', 'PRE'])

export type ComposerEditorHandle = Readonly<{
  focus(): void
  getDraft(): string
}>

type ComposerEditorProperties = Readonly<{
  availableSkills: readonly SessionSkill[]
  describedBy: string
  draft: string
  label: string
  readOnly: boolean
  onChange: (draft: string) => void
  onFocus: () => void
  onSubmit: (delivery: SessionMessageDelivery) => void
}>

function normalizeComposerCaretMarkers(text: string): string {
  return text
    .replace(new RegExp(`${composerCaretMarker}$`), '')
    .replace(new RegExp(`${composerCaretMarker}(?=\\s)`, 'g'), '')
    .replaceAll(composerCaretMarker, ' ')
}

function appendPlainText(paragraph: ReturnType<typeof $createParagraphNode>, text: string): void {
  text.split('\n').forEach((line, index) => {
    if (index > 0) paragraph.append($createLineBreakNode())
    if (line.length > 0) paragraph.append($createTextNode(line))
  })
}

function skillReference(skillName: string, availableSkills: readonly SessionSkill[]): SessionSkillReference {
  const available = availableSkills.find((skill) => skill.name === skillName)

  return available ? { ...available, availability: 'available' } : { name: skillName, availability: 'unavailable' }
}

function replaceDraft(draft: string, availableSkills: readonly SessionSkill[], selectEnd = false): void {
  const root = $getRoot()
  const paragraph = $createParagraphNode()
  const projected = projectSessionSkillSelections(draft)
  let textOffset = 0

  for (const selection of projected.selections) {
    appendPlainText(paragraph, projected.text.slice(textOffset, selection.offset))
    paragraph.append($createComposerSkillNode(skillReference(selection.name, availableSkills)))
    textOffset = selection.offset
  }

  appendPlainText(paragraph, projected.text.slice(textOffset))
  if ($isComposerSkillNode(paragraph.getLastChild())) paragraph.append($createTextNode(composerCaretMarker))
  root.clear().append(paragraph)

  if (selectEnd) paragraph.selectEnd()
}

function getDOMPlainText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ?? ''
  }

  if (node.nodeName === 'BR') {
    return '\n'
  }

  const childText = Array.from(node.childNodes, getDOMPlainText).join('')
  return htmlBlockNames.has(node.nodeName) && childText.length > 0 && !childText.endsWith('\n')
    ? `${childText}\n`
    : childText
}

function getDOMComposerDraft(node: Node): string {
  if (node instanceof HTMLElement && node.hasAttribute('data-skill-reference')) {
    return `/skill:${node.getAttribute('data-skill-reference') ?? ''}`
  }

  if (node.nodeType === Node.TEXT_NODE) return normalizeComposerCaretMarkers(node.textContent ?? '')
  if (node.nodeName === 'BR') return '\n'

  const childText = Array.from(node.childNodes, getDOMComposerDraft).join('')
  return htmlBlockNames.has(node.nodeName) && childText.length > 0 && !childText.endsWith('\n')
    ? `${childText}\n`
    : childText
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

  return getDOMPlainText(new DOMParser().parseFromString(html, 'text/html').body).replace(/\n+$/, '')
}

function removeSkillNode(skillNode: ComposerSkillNode): void {
  const nextSibling = skillNode.getNextSibling()
  if ($isTextNode(nextSibling) && nextSibling.getTextContent().includes(composerCaretMarker)) {
    const text = nextSibling.getTextContent().replaceAll(composerCaretMarker, '')
    if (text.length > 0) nextSibling.setTextContent(text)
    else nextSibling.remove()
  }
  skillNode.remove()
}

function ComposerEditorPlugins({
  availableSkills,
  draft,
  readOnly,
  onChange,
  onSubmit,
  editorHandle,
}: Pick<ComposerEditorProperties, 'availableSkills' | 'draft' | 'readOnly' | 'onChange' | 'onSubmit'> & {
  editorHandle: React.Ref<ComposerEditorHandle>
}) {
  const [editor] = useLexicalComposerContext()

  useImperativeHandle(editorHandle, () => ({
    focus() {
      editor.getRootElement()?.focus()
      editor.focus()
    },
    getDraft() {
      const rootElement = editor.getRootElement()
      return rootElement ? getDOMComposerDraft(rootElement).replace(/\n+$/, '') : draft
    },
  }))

  useEffect(() => {
    editor.setEditable(!readOnly)
  }, [editor, readOnly])

  useEffect(() => {
    const rootElement = editor.getRootElement()
    if (!rootElement) return

    const preventDuplicateSpace = (event: KeyboardEvent) => {
      if (event.target !== rootElement || event.key !== ' ') return

      const selection = window.getSelection()
      if (
        !selection?.isCollapsed ||
        selection.anchorNode?.nodeType !== Node.TEXT_NODE ||
        selection.anchorNode.textContent !== composerCaretMarker ||
        selection.anchorOffset !== composerCaretMarker.length
      ) {
        return
      }

      event.preventDefault()
    }

    rootElement.addEventListener('keydown', preventDuplicateSpace)
    return () => rootElement.removeEventListener('keydown', preventDuplicateSpace)
  }, [editor])

  useEffect(() => {
    editor.getEditorState().read(() => {
      if (normalizeComposerCaretMarkers($getRoot().getTextContent()) === draft) return

      editor.update(() => replaceDraft(draft, availableSkills), { tag: externalDraftUpdateTag })
    })
  }, [availableSkills, draft, editor])

  useEffect(() => {
    editor.update(() => {
      for (const node of $nodesOfType(ComposerSkillNode)) {
        node.setSkill(skillReference(node.getSkill().name, availableSkills))
      }
    })
  }, [availableSkills, editor])

  useEffect(
    () =>
      editor.registerNodeTransform(TextNode, (node) => {
        const text = node.getTextContent()
        if (text === composerCaretMarker || !text.includes(composerCaretMarker)) return

        node.setTextContent(normalizeComposerCaretMarkers(text))
      }),
    [editor]
  )

  useEffect(
    () =>
      editor.registerCommand(
        KEY_ENTER_COMMAND,
        (event) => {
          if (!event) {
            return false
          }

          if (event.target instanceof HTMLElement && event.target.closest('button')) {
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

            replaceDraft(
              `${normalizeComposerCaretMarkers($getRoot().getTextContent())}${plainText}`,
              availableSkills,
              true
            )
          })

          return true
        },
        COMMAND_PRIORITY_HIGH
      ),
    [availableSkills, editor]
  )

  useEffect(
    () =>
      editor.registerCommand(
        CONTROLLED_TEXT_INSERTION_COMMAND,
        (text) => {
          if ($getSelection() !== null || typeof text !== 'string') return false

          const firstElement = $getRoot().getFirstChild()
          if (!$isElementNode(firstElement)) return false

          const marker = firstElement.getLastChild()
          if (!$isTextNode(marker) || marker.getTextContent() !== composerCaretMarker) return false

          const skillNode = marker.getPreviousSibling()
          if (!$isComposerSkillNode(skillNode)) return false

          marker.setTextContent(`${composerCaretMarker}${text}`).selectEnd()
          return true
        },
        COMMAND_PRIORITY_CRITICAL
      ),
    [editor]
  )

  useEffect(
    () =>
      editor.registerCommand(
        KEY_BACKSPACE_COMMAND,
        (event) => {
          if (!event) return false

          const selection = $getSelection()
          if (selection === null) {
            const skillNode = $nodesOfType(ComposerSkillNode).at(-1)
            if (!skillNode) return false

            event.preventDefault()
            removeSkillNode(skillNode)
            return true
          }
          if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false

          const anchor = selection.anchor
          const anchorNode = anchor.getNode()
          const previousNode =
            anchor.type === 'element'
              ? $isElementNode(anchorNode)
                ? anchorNode.getChildAtIndex(anchor.offset - 1)
                : undefined
              : anchor.offset === 0 && $isTextNode(anchorNode)
                ? anchorNode.getPreviousSibling()
                : undefined
          if (!$isComposerSkillNode(previousNode)) return false

          event.preventDefault()
          removeSkillNode(previousNode)
          return true
        },
        COMMAND_PRIORITY_CRITICAL
      ),
    [editor]
  )

  useEffect(
    () =>
      editor.registerCommand(
        removeComposerSkillCommand,
        (nodeKey) => {
          const skillNode = $getComposerSkillNode(nodeKey)
          if (!skillNode) return false

          removeSkillNode(skillNode)
          editor.focus()
          return true
        },
        COMMAND_PRIORITY_CRITICAL
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
          const nextDraft = normalizeComposerCaretMarkers($getRoot().getTextContent())

          if (nextDraft !== draft) {
            onChange(nextDraft)
          }
        })
      }),
    [draft, editor, onChange]
  )

  return (
    <>
      <HistoryPlugin />
      <SkillAutocomplete availableSkills={availableSkills} draft={draft} disabled={readOnly} />
    </>
  )
}

type SkillQuery = Readonly<{
  draft: string
  startOffset: number
  endOffset: number
  search: string
  signature: string
}>

function findSkillQuery(draft: string, caretOffset: number): SkillQuery | undefined {
  const textBeforeCaret = draft.slice(0, caretOffset)
  const match = /(?:^|\s)\/([^\s/]*)$/.exec(textBeforeCaret)
  if (!match) return undefined

  const rawSearch = match[1] ?? ''
  const startOffset = caretOffset - rawSearch.length - 1
  const search = rawSearch.toLowerCase().replace(/^skill:/, '')

  return {
    draft,
    startOffset,
    endOffset: caretOffset,
    search,
    signature: `${startOffset}:${caretOffset}:${search}`,
  }
}

function getDOMTextLength(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent?.length ?? 0
  if (node.nodeName === 'BR') return 1

  return Array.from(node.childNodes).reduce((length, child) => length + getDOMTextLength(child), 0)
}

function getDOMOffsetWithin(node: Node, anchorNode: Node, anchorOffset: number): number | undefined {
  if (node === anchorNode) {
    if (node.nodeType === Node.TEXT_NODE) return anchorOffset

    return Array.from(node.childNodes)
      .slice(0, anchorOffset)
      .reduce((length, child) => length + getDOMTextLength(child), 0)
  }

  let precedingLength = 0
  for (const child of Array.from(node.childNodes)) {
    const childOffset = getDOMOffsetWithin(child, anchorNode, anchorOffset)
    if (childOffset !== undefined) return precedingLength + childOffset
    precedingLength += getDOMTextLength(child)
  }

  return undefined
}

function getDOMSkillQuery(editor: LexicalEditor): SkillQuery | undefined {
  const rootElement = editor.getRootElement()
  if (!rootElement) return undefined

  const rawDraft = getDOMPlainText(rootElement).replace(/\n+$/, '')
  const selection = window.getSelection()
  const rawCaretOffset =
    selection?.isCollapsed && selection.anchorNode && rootElement.contains(selection.anchorNode)
      ? getDOMOffsetWithin(rootElement, selection.anchorNode, selection.anchorOffset)
      : undefined
  const draft = normalizeComposerCaretMarkers(rawDraft)
  const caretOffset =
    rawCaretOffset === undefined
      ? document.activeElement === rootElement
        ? draft.length
        : undefined
      : normalizeComposerCaretMarkers(rawDraft.slice(0, rawCaretOffset)).length

  return caretOffset === undefined ? undefined : findSkillQuery(draft, caretOffset)
}

function canonicalDraftOffset(draft: string, visibleOffset: number): number {
  const { selections } = projectSessionSkillSelections(draft)
  let precedingSkillNameLength = 0
  let tokenPrefixLength = 0

  for (const selection of selections) {
    const visibleSkillEnd = selection.offset + precedingSkillNameLength + selection.name.length
    if (visibleSkillEnd > visibleOffset) break

    precedingSkillNameLength += selection.name.length
    tokenPrefixLength += '/skill:'.length
  }

  return visibleOffset + tokenPrefixLength
}

function insertSkillAtSelection(skill: SessionSkill): string | undefined {
  const selection = $getSelection()
  if (!$isRangeSelection(selection) || !selection.isCollapsed() || selection.anchor.type !== 'text') return undefined

  const anchorNode = selection.anchor.getNode()
  if (!$isTextNode(anchorNode)) return undefined

  const textBeforeCaret = anchorNode.getTextContent().slice(0, selection.anchor.offset)
  const match = /(?:^|\s)\/([^\s/]*)$/.exec(textBeforeCaret)
  if (!match) return undefined

  const queryLength = (match[1]?.length ?? 0) + 1
  const queryStart = selection.anchor.offset - queryLength
  selection.setTextNodeRange(anchorNode, queryStart, anchorNode, selection.anchor.offset)

  const marker = $createTextNode(composerCaretMarker)
  selection.insertNodes([$createComposerSkillNode({ ...skill, availability: 'available' }), marker])
  marker.select(composerCaretMarker.length, composerCaretMarker.length)
  return marker.getKey()
}

function selectDraftOffset(offset: number): void {
  let remaining = offset
  const firstElement = $getRoot().getFirstChild()
  if (!$isElementNode(firstElement)) return

  for (const child of firstElement.getChildren()) {
    const childText = child.getTextContent()

    if ($isTextNode(child) && remaining <= childText.length) {
      const selectionOffset = childText === composerCaretMarker ? composerCaretMarker.length : remaining
      child.select(selectionOffset, selectionOffset)
      return
    }

    remaining -= childText.length
  }

  firstElement.selectEnd()
}

function SkillAutocomplete({
  availableSkills,
  draft,
  disabled,
}: Readonly<{
  availableSkills: readonly SessionSkill[]
  draft: string
  disabled: boolean
}>) {
  const [editor] = useLexicalComposerContext()
  const listboxId = useId()
  const [activeIndex, setActiveIndex] = useState(0)
  const [query, setQuery] = useState<SkillQuery>()
  const [dismissedQuery, setDismissedQuery] = useState<string>()
  const options = useMemo(
    () =>
      disabled || !query || dismissedQuery === query.signature
        ? []
        : availableSkills.filter((skill) => `${skill.name} ${skill.description}`.toLowerCase().includes(query.search)),
    [availableSkills, disabled, dismissedQuery, query]
  )
  const activeOptionId = options[activeIndex] ? `${listboxId}-option-${activeIndex}` : undefined

  useEffect(() => {
    const rootElement = editor.getRootElement()
    if (!rootElement) return

    rootElement.setAttribute('aria-autocomplete', 'list')
    rootElement.setAttribute('aria-haspopup', 'listbox')
    rootElement.setAttribute('aria-expanded', options.length > 0 ? 'true' : 'false')

    if (activeOptionId) {
      rootElement.setAttribute('aria-controls', listboxId)
      rootElement.setAttribute('aria-activedescendant', activeOptionId)
    } else {
      rootElement.removeAttribute('aria-controls')
      rootElement.removeAttribute('aria-activedescendant')
    }

    return () => {
      rootElement.removeAttribute('aria-autocomplete')
      rootElement.removeAttribute('aria-haspopup')
      rootElement.removeAttribute('aria-expanded')
      rootElement.removeAttribute('aria-controls')
      rootElement.removeAttribute('aria-activedescendant')
    }
  }, [activeOptionId, editor, listboxId, options.length])

  useEffect(() => {
    if (!activeOptionId) return

    editor
      .getRootElement()
      ?.ownerDocument.getElementById(activeOptionId)
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeOptionId, editor])

  useEffect(() => {
    const rootElement = editor.getRootElement()
    if (!rootElement) return

    setQuery(disabled ? undefined : getDOMSkillQuery(editor))
  }, [disabled, draft, editor])

  useEffect(() => {
    const rootElement = editor.getRootElement()
    if (!rootElement) return

    let frame: number | undefined
    const publishQuery = () => {
      if (frame !== undefined) window.cancelAnimationFrame(frame)

      frame = window.requestAnimationFrame(() => {
        frame = undefined
        setQuery(disabled ? undefined : getDOMSkillQuery(editor))
      })
    }

    rootElement.addEventListener('focus', publishQuery)
    rootElement.addEventListener('input', publishQuery)
    rootElement.addEventListener('keyup', publishQuery)
    document.addEventListener('selectionchange', publishQuery)

    return () => {
      rootElement.removeEventListener('focus', publishQuery)
      rootElement.removeEventListener('input', publishQuery)
      rootElement.removeEventListener('keyup', publishQuery)
      document.removeEventListener('selectionchange', publishQuery)
      if (frame !== undefined) window.cancelAnimationFrame(frame)
    }
  }, [disabled, draft, editor])

  useEffect(() => {
    setActiveIndex(0)
    if (dismissedQuery !== query?.signature) setDismissedQuery(undefined)
  }, [dismissedQuery, query?.signature])

  const select = useCallback(
    (skill: SessionSkill) => {
      if (!query) return

      const rootElement = editor.getRootElement()
      if (!rootElement) return

      const currentDraft = getDOMComposerDraft(rootElement).replace(/\n+$/, '')
      const startOffset = canonicalDraftOffset(currentDraft, query.startOffset)
      const endOffset = canonicalDraftOffset(currentDraft, query.endOffset)
      const token = `/skill:${skill.name}`
      const nextDraft = `${currentDraft.slice(0, startOffset)}${token}${currentDraft.slice(endOffset)}`
      let markerKey: string | undefined
      const insert = () => {
        replaceDraft(currentDraft, availableSkills)
        selectDraftOffset(endOffset)
        markerKey = insertSkillAtSelection(skill)

        if (!markerKey) {
          replaceDraft(nextDraft, availableSkills)
          selectDraftOffset(startOffset + token.length)
        }
      }

      editor.update(insert, {
        discrete: true,
        onUpdate() {
          if (!markerKey) return

          const rootElement = editor.getRootElement()
          const markerElement = editor.getElementByKey(markerKey)
          const markerText = markerElement?.firstChild
          if (!rootElement || !markerText) return

          rootElement.focus()
          const range = document.createRange()
          range.setStart(markerText, markerText.textContent?.length ?? 0)
          range.collapse(true)

          const selection = window.getSelection()
          selection?.removeAllRanges()
          selection?.addRange(range)
        },
      })
    },
    [availableSkills, editor, query]
  )

  useEffect(() => {
    const unregister = [
      editor.registerCommand(
        KEY_ARROW_DOWN_COMMAND,
        (event) => {
          if (options.length === 0) return false

          event?.preventDefault()
          setActiveIndex((index) => (index + 1) % options.length)
          return true
        },
        COMMAND_PRIORITY_CRITICAL
      ),
      editor.registerCommand(
        KEY_ARROW_UP_COMMAND,
        (event) => {
          if (options.length === 0) return false

          event?.preventDefault()
          setActiveIndex((index) => (index - 1 + options.length) % options.length)
          return true
        },
        COMMAND_PRIORITY_CRITICAL
      ),
      editor.registerCommand(
        KEY_ENTER_COMMAND,
        (event) => {
          const skill = options[activeIndex]
          if (!event || !skill) return false

          event.preventDefault()
          select(skill)
          return true
        },
        COMMAND_PRIORITY_CRITICAL
      ),
      editor.registerCommand(
        KEY_TAB_COMMAND,
        (event) => {
          const skill = options[activeIndex]
          if (!event || !skill) return false

          event.preventDefault()
          select(skill)
          return true
        },
        COMMAND_PRIORITY_CRITICAL
      ),
      editor.registerCommand(
        KEY_ESCAPE_COMMAND,
        (event) => {
          if (options.length === 0) return false

          event?.preventDefault()
          setDismissedQuery(query?.signature)
          return true
        },
        COMMAND_PRIORITY_CRITICAL
      ),
    ]

    return () => unregister.forEach((dispose) => dispose())
  }, [activeIndex, editor, options, query?.signature, select])

  if (options.length === 0) return null

  return (
    <div
      id={listboxId}
      aria-label="Skills"
      className="absolute right-3.5 bottom-full left-3.5 z-30 mb-1 max-h-64 overflow-y-auto rounded-lg border border-content-border bg-content-background p-1 shadow-lg"
      data-placement="top"
      role="listbox"
    >
      {options.map((skill, index) => (
        <div
          id={`${listboxId}-option-${index}`}
          key={skill.name}
          aria-selected={index === activeIndex}
          className="cursor-pointer rounded-md px-2.5 py-2 text-left data-[selected=true]:bg-session-interaction"
          data-selected={index === activeIndex ? 'true' : undefined}
          onClick={() => select(skill)}
          onMouseDown={(event) => event.preventDefault()}
          onMouseEnter={() => setActiveIndex(index)}
          role="option"
        >
          <div className="text-sm/5 font-medium text-content-foreground">{skill.name}</div>
          <div className="line-clamp-2 text-xs/5 text-content-muted-foreground">{skill.description}</div>
        </div>
      ))}
    </div>
  )
}

export const ComposerEditor = forwardRef<ComposerEditorHandle, ComposerEditorProperties>(function ComposerEditor(
  { availableSkills, describedBy, draft, label, readOnly, onChange, onFocus, onSubmit },
  editorHandle
) {
  return (
    <LexicalComposer
      initialConfig={{
        namespace: `Composer:${label}`,
        editable: !readOnly,
        editorState: () => replaceDraft(draft, availableSkills, true),
        nodes: [ComposerSkillNode],
        onError(error) {
          throw error
        },
        theme: {},
      }}
    >
      <div className="relative z-10 min-w-0">
        <div className="flex min-h-13 items-start px-3.5 py-3.5">
          <div className="relative min-w-0 flex-1">
            <PlainTextPlugin
              contentEditable={
                <ContentEditable
                  aria-describedby={describedBy}
                  aria-label={label}
                  aria-multiline="true"
                  className="composer-editable relative z-10 block min-h-6 w-full resize-none overflow-y-auto bg-transparent text-sm/6 text-composer-foreground outline-none"
                  onFocus={onFocus}
                  role="textbox"
                  spellCheck
                />
              }
              placeholder={
                <div className="pointer-events-none absolute top-0 left-0 text-sm/6 text-composer-muted-foreground">
                  Ask Pi…
                </div>
              }
              ErrorBoundary={LexicalErrorBoundary}
            />
          </div>
        </div>
        <ComposerEditorPlugins
          availableSkills={availableSkills}
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
