import type { ReactNode } from 'react'
import {
  $applyNodeReplacement,
  $getNodeByKey,
  createCommand,
  DecoratorNode,
  type LexicalCommand,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from 'lexical'
import { FileReference } from '@/src/renderer/components/file-reference'
import { sessionFileToken, type SessionFileReference } from '@/src/session-files'

type SerializedComposerFileNode = Spread<Readonly<{ file: SessionFileReference }>, SerializedLexicalNode>

export const removeComposerFileCommand: LexicalCommand<NodeKey> = createCommand('REMOVE_COMPOSER_FILE_COMMAND')

export class ComposerFileNode extends DecoratorNode<ReactNode> {
  __file: SessionFileReference

  static getType(): string {
    return 'composer-file'
  }

  static clone(node: ComposerFileNode): ComposerFileNode {
    return new ComposerFileNode(node.__file, node.__key)
  }

  static importJSON(serializedNode: SerializedComposerFileNode): ComposerFileNode {
    return $createComposerFileNode(serializedNode.file).updateFromJSON(serializedNode)
  }

  constructor(file: SessionFileReference, key?: NodeKey) {
    super(key)
    this.__file = file
  }

  isInline(): true {
    return true
  }

  createDOM(): HTMLElement {
    const element = document.createElement('span')
    element.className = 'inline'
    return element
  }

  updateDOM(): false {
    return false
  }

  exportJSON(): SerializedComposerFileNode {
    return { ...super.exportJSON(), file: this.__file }
  }

  getTextContent(): string {
    return sessionFileToken(this.getLatest().__file.path)
  }

  getFile(): SessionFileReference {
    return this.getLatest().__file
  }

  setFile(file: SessionFileReference): this {
    const writable = this.getWritable()
    writable.__file = file
    return writable
  }

  decorate(editor: LexicalEditor): ReactNode {
    return (
      <FileReference
        file={this.__file}
        onRemove={() => editor.dispatchCommand(removeComposerFileCommand, this.getKey())}
      />
    )
  }
}

export function $createComposerFileNode(file: SessionFileReference): ComposerFileNode {
  return $applyNodeReplacement(new ComposerFileNode(file))
}

export function $isComposerFileNode(node: LexicalNode | null | undefined): node is ComposerFileNode {
  return node instanceof ComposerFileNode
}

export function $getComposerFileNode(key: NodeKey): ComposerFileNode | undefined {
  const node = $getNodeByKey(key)
  return $isComposerFileNode(node) ? node : undefined
}
