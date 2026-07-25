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
  $createComposerFileNode,
  $getComposerFileNode,
  $isComposerFileNode,
  ComposerFileNode,
  removeComposerFileCommand,
} from '@/src/renderer/components/composer-file-node'
import {
  $createComposerSkillNode,
  $getComposerSkillNode,
  $isComposerSkillNode,
  ComposerSkillNode,
  removeComposerSkillCommand,
} from '@/src/renderer/components/composer-skill-node'
import type { SessionSkill, SessionSkillReference } from '@/src/session-skills'
import {
  findSessionFileTokens,
  sessionFileToken,
  type SessionFile,
  type SessionFileReference,
} from '@/src/session-files'

const externalDraftUpdateTag = 'composer-external-draft'
const composerCaretMarker = '\u00a0'
const htmlBlockNames = new Set(['ADDRESS', 'ARTICLE', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'P', 'PRE'])

export type ComposerEditorHandle = Readonly<{
  focus(): void
  getDraft(): string
}>

type ComposerEditorProperties = Readonly<{
  availableSkills: readonly SessionSkill[]
  availableFiles: readonly SessionFile[]
  describedBy: string
  draft: string
  label: string
  readOnly: boolean
  onChange: (draft: string) => void
  onFocus: () => void
  onFileQuery: (query: string) => void
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

function fileReference(path: string, availableFiles: readonly SessionFile[]): SessionFileReference {
  const available = availableFiles.find((file) => file.path === path)

  return available
    ? { path: available.path, kind: available.kind, availability: 'available' }
    : { path, kind: 'file', availability: 'unavailable' }
}

type ComposerReferenceToken = Readonly<{
  startOffset: number
  endOffset: number
  visibleLength: number
  type: 'skill' | 'file'
  value: string
}>

function composerReferenceTokens(draft: string): readonly ComposerReferenceToken[] {
  const skills = [...draft.matchAll(/(?<!\S)\/skill:([a-z0-9]+(?:-[a-z0-9]+)*)/g)].flatMap((match) => {
    const name = match[1]
    const startOffset = match.index
    if (!name || startOffset === undefined) return []

    return [
      {
        startOffset,
        endOffset: startOffset + match[0].length,
        visibleLength: name.length,
        type: 'skill' as const,
        value: name,
      },
    ]
  })
  const files = findSessionFileTokens(draft).map((token) => ({
    startOffset: token.startOffset,
    endOffset: token.endOffset,
    visibleLength: token.path.length + 1,
    type: 'file' as const,
    value: token.path,
  }))

  return [...skills, ...files].sort((left, right) => left.startOffset - right.startOffset)
}

function replaceDraft(
  draft: string,
  availableSkills: readonly SessionSkill[],
  availableFiles: readonly SessionFile[] = [],
  selectEnd = false
): void {
  const root = $getRoot()
  const paragraph = $createParagraphNode()
  let textOffset = 0

  for (const token of composerReferenceTokens(draft)) {
    appendPlainText(paragraph, draft.slice(textOffset, token.startOffset))
    if (token.type === 'skill') paragraph.append($createComposerSkillNode(skillReference(token.value, availableSkills)))
    else paragraph.append($createComposerFileNode(fileReference(token.value, availableFiles)))
    textOffset = token.endOffset
  }

  appendPlainText(paragraph, draft.slice(textOffset))
  if ($isComposerSkillNode(paragraph.getLastChild()) || $isComposerFileNode(paragraph.getLastChild())) {
    paragraph.append($createTextNode(composerCaretMarker))
  }
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
  if (node instanceof HTMLElement && node.hasAttribute('data-file-reference')) {
    return sessionFileToken(node.getAttribute('data-file-reference') ?? '')
  }

  if (node.nodeType === Node.TEXT_NODE) return normalizeComposerCaretMarkers(node.textContent ?? '')
  if (node.nodeName === 'BR') {
    return node instanceof HTMLElement && node.hasAttribute('data-lexical-managed-linebreak') ? '' : '\n'
  }

  const children =
    node instanceof HTMLElement &&
    node.hasAttribute('data-lexical-editor') &&
    node.querySelector('[data-file-reference]')
      ? Array.from(node.childNodes).filter((child) => child.nodeType !== Node.TEXT_NODE)
      : Array.from(node.childNodes)
  const childText = children.map(getDOMComposerDraft).join('')
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

function removeInlineReferenceNode(referenceNode: ComposerSkillNode | ComposerFileNode): void {
  const nextSibling = referenceNode.getNextSibling()
  if ($isTextNode(nextSibling) && nextSibling.getTextContent().includes(composerCaretMarker)) {
    const text = nextSibling.getTextContent().replaceAll(composerCaretMarker, '')
    if (text.length > 0) nextSibling.setTextContent(text)
    else nextSibling.remove()
  }
  referenceNode.remove()
}

function ComposerEditorPlugins({
  availableSkills,
  availableFiles,
  draft,
  readOnly,
  onChange,
  onSubmit,
  editorHandle,
}: Pick<
  ComposerEditorProperties,
  'availableSkills' | 'availableFiles' | 'draft' | 'readOnly' | 'onChange' | 'onSubmit'
> & {
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

      editor.update(() => replaceDraft(draft, availableSkills, availableFiles), { tag: externalDraftUpdateTag })
    })
  }, [availableFiles, availableSkills, draft, editor])

  useEffect(() => {
    editor.update(() => {
      for (const node of $nodesOfType(ComposerSkillNode)) {
        node.setSkill(skillReference(node.getSkill().name, availableSkills))
      }
      for (const node of $nodesOfType(ComposerFileNode)) {
        node.setFile(fileReference(node.getFile().path, availableFiles))
      }
    })
  }, [availableFiles, availableSkills, editor])

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
              availableFiles,
              true
            )
          })

          return true
        },
        COMMAND_PRIORITY_HIGH
      ),
    [availableFiles, availableSkills, editor]
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

          const referenceNode = marker.getPreviousSibling()
          if (!$isComposerSkillNode(referenceNode) && !$isComposerFileNode(referenceNode)) return false

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
            const referenceNode = [...$nodesOfType(ComposerSkillNode), ...$nodesOfType(ComposerFileNode)].at(-1)
            if (!referenceNode) return false

            event.preventDefault()
            removeInlineReferenceNode(referenceNode)
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
          if (!$isComposerSkillNode(previousNode) && !$isComposerFileNode(previousNode)) return false

          event.preventDefault()
          removeInlineReferenceNode(previousNode)
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

          removeInlineReferenceNode(skillNode)
          editor.focus()
          return true
        },
        COMMAND_PRIORITY_CRITICAL
      ),
    [editor]
  )

  useEffect(
    () =>
      editor.registerCommand(
        removeComposerFileCommand,
        (nodeKey) => {
          const fileNode = $getComposerFileNode(nodeKey)
          if (!fileNode) return false

          removeInlineReferenceNode(fileNode)
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
      <SkillAutocomplete
        availableSkills={availableSkills}
        availableFiles={availableFiles}
        draft={draft}
        disabled={readOnly}
      />
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

function findFileQuery(draft: string, caretOffset: number): SkillQuery | undefined {
  const textBeforeCaret = draft.slice(0, caretOffset)
  const match = /(?:^|\s)@([^\s@,.;:!?)}\]]*)$/.exec(textBeforeCaret)
  if (!match) return undefined

  const search = (match[1] ?? '').toLowerCase()
  const startOffset = caretOffset - search.length - 1

  return { draft, startOffset, endOffset: caretOffset, search, signature: `${startOffset}:${caretOffset}:${search}` }
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
  let sourceOffset = 0
  let currentVisibleOffset = 0

  for (const token of composerReferenceTokens(draft)) {
    const plainTextLength = token.startOffset - sourceOffset
    if (visibleOffset <= currentVisibleOffset + plainTextLength) {
      return sourceOffset + visibleOffset - currentVisibleOffset
    }

    currentVisibleOffset += plainTextLength

    if (visibleOffset <= currentVisibleOffset + token.visibleLength) {
      return visibleOffset === currentVisibleOffset ? token.startOffset : token.endOffset
    }

    sourceOffset = token.endOffset
    currentVisibleOffset += token.visibleLength
  }

  return sourceOffset + visibleOffset - currentVisibleOffset
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

function getDOMFileQuery(editor: LexicalEditor): SkillQuery | undefined {
  const rootElement = editor.getRootElement()
  if (!rootElement) return undefined

  const draft = getDOMComposerDraft(rootElement).replace(/\n+$/, '')
  const selection = window.getSelection()
  const visibleCaretOffset =
    selection?.isCollapsed && selection.anchorNode && rootElement.contains(selection.anchorNode)
      ? getDOMOffsetWithin(rootElement, selection.anchorNode, selection.anchorOffset)
      : undefined
  const caretOffset = visibleCaretOffset === undefined ? undefined : canonicalDraftOffset(draft, visibleCaretOffset)

  return caretOffset === undefined ? undefined : findFileQuery(draft, caretOffset)
}

function insertFileAtSelection(file: SessionFile): string | undefined {
  const selection = $getSelection()
  if (!$isRangeSelection(selection) || !selection.isCollapsed() || selection.anchor.type !== 'text') return undefined

  const anchorNode = selection.anchor.getNode()
  if (!$isTextNode(anchorNode)) return undefined

  const textBeforeCaret = anchorNode.getTextContent().slice(0, selection.anchor.offset)
  const match = /(?:^|\s)@([^\s@]*)$/.exec(textBeforeCaret)
  if (!match) return undefined

  const queryLength = (match[1]?.length ?? 0) + 1
  const queryStart = selection.anchor.offset - queryLength
  selection.setTextNodeRange(anchorNode, queryStart, anchorNode, selection.anchor.offset)

  const marker = $createTextNode(composerCaretMarker)
  selection.insertNodes([
    $createComposerFileNode({ path: file.path, kind: file.kind, availability: 'available' }),
    marker,
  ])
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
  availableFiles,
  draft,
  disabled,
}: Readonly<{
  availableSkills: readonly SessionSkill[]
  availableFiles: readonly SessionFile[]
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
        replaceDraft(currentDraft, availableSkills, availableFiles)
        selectDraftOffset(endOffset)
        markerKey = insertSkillAtSelection(skill)

        if (!markerKey) {
          replaceDraft(nextDraft, availableSkills, availableFiles)
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
    [availableFiles, availableSkills, editor, query]
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

function FileAutocomplete({
  availableFiles,
  availableSkills,
  disabled,
  onQuery,
}: Readonly<{
  availableFiles: readonly SessionFile[]
  availableSkills: readonly SessionSkill[]
  disabled: boolean
  onQuery: (query: string) => void
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
        : availableFiles.filter((file) => file.path.toLowerCase().includes(query.search)),
    [availableFiles, disabled, dismissedQuery, query]
  )

  useEffect(() => {
    const root = editor.getRootElement()
    if (!root) return
    const update = () => setQuery(disabled ? undefined : getDOMFileQuery(editor))
    root.addEventListener('input', update)
    root.addEventListener('keyup', update)
    root.addEventListener('focus', update)
    document.addEventListener('selectionchange', update)
    update()
    return () => {
      root.removeEventListener('input', update)
      root.removeEventListener('keyup', update)
      root.removeEventListener('focus', update)
      document.removeEventListener('selectionchange', update)
    }
  }, [disabled, editor])

  useEffect(() => {
    onQuery(query?.search ?? '')
  }, [onQuery, query?.search])

  useEffect(() => {
    setActiveIndex(0)
    if (dismissedQuery !== query?.signature) setDismissedQuery(undefined)
  }, [dismissedQuery, query?.signature])

  const select = useCallback(
    (file: SessionFile) => {
      if (!query) return
      const root = editor.getRootElement()
      if (!root) return

      const currentDraft = getDOMComposerDraft(root).replace(/\n+$/, '')
      const suffix = currentDraft.slice(query.endOffset)
      const token = sessionFileToken(file.path)
      const nextDraft = `${currentDraft.slice(0, query.startOffset)}${token}${suffix.length > 0 ? ` ${suffix}` : ''}`
      let markerKey: string | undefined
      editor.update(
        () => {
          replaceDraft(currentDraft, availableSkills, availableFiles)
          selectDraftOffset(query.endOffset)
          markerKey = insertFileAtSelection(file)
          if (!markerKey) replaceDraft(nextDraft, availableSkills, availableFiles)
        },
        {
          discrete: true,
          onUpdate() {
            setDismissedQuery(
              `${query.startOffset}:${query.startOffset + file.path.length + 1}:${file.path.toLowerCase()}`
            )
            root.focus()
          },
        }
      )
    },
    [availableFiles, availableSkills, editor, query]
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
          const file = options[activeIndex]
          if (!event || !file) return false
          event.preventDefault()
          select(file)
          return true
        },
        COMMAND_PRIORITY_CRITICAL
      ),
      editor.registerCommand(
        KEY_TAB_COMMAND,
        (event) => {
          const file = options[activeIndex]
          if (!event || !file) return false
          event.preventDefault()
          select(file)
          return true
        },
        COMMAND_PRIORITY_CRITICAL
      ),
    ]
    return () => unregister.forEach((dispose) => dispose())
  }, [activeIndex, editor, options, select])

  if (!query || options.length === 0) return null

  return (
    <div
      aria-label="Files and folders"
      id={listboxId}
      className="absolute right-3.5 bottom-full left-3.5 z-30 mb-1 max-h-64 overflow-y-auto rounded-lg border border-content-border bg-content-background p-1 shadow-lg"
      role="listbox"
    >
      {options.map((file, index) => (
        <button
          key={file.path}
          id={`${listboxId}-option-${index}`}
          type="button"
          aria-selected={index === activeIndex}
          className="block w-full rounded-md px-2.5 py-2 text-left hover:bg-session-interaction data-[selected=true]:bg-session-interaction"
          onMouseDown={(event) => event.preventDefault()}
          data-selected={index === activeIndex ? 'true' : undefined}
          onClick={() => select(file)}
          onMouseEnter={() => setActiveIndex(index)}
          role="option"
        >
          <div className="text-sm/5 font-medium text-content-foreground">{file.path}</div>
          <div className="text-xs/5 text-content-muted-foreground">{file.kind}</div>
        </button>
      ))}
    </div>
  )
}

export const ComposerEditor = forwardRef<ComposerEditorHandle, ComposerEditorProperties>(function ComposerEditor(
  { availableSkills, availableFiles, describedBy, draft, label, readOnly, onChange, onFocus, onFileQuery, onSubmit },
  editorHandle
) {
  return (
    <LexicalComposer
      initialConfig={{
        namespace: `Composer:${label}`,
        editable: !readOnly,
        editorState: () => replaceDraft(draft, availableSkills, availableFiles, true),
        nodes: [ComposerSkillNode, ComposerFileNode],
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
          availableFiles={availableFiles}
          draft={draft}
          readOnly={readOnly}
          onChange={onChange}
          onSubmit={onSubmit}
          editorHandle={editorHandle}
        />
        <FileAutocomplete
          availableFiles={availableFiles}
          availableSkills={availableSkills}
          disabled={readOnly}
          onQuery={onFileQuery}
        />
      </div>
    </LexicalComposer>
  )
})
