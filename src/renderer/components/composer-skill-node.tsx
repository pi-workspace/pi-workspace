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
import { SkillReference } from '@/src/renderer/components/skill-reference'
import type { SessionSkillReference } from '@/src/session-skills'

type SerializedComposerSkillNode = Spread<
  Readonly<{
    skill: SessionSkillReference
  }>,
  SerializedLexicalNode
>

export const removeComposerSkillCommand: LexicalCommand<NodeKey> = createCommand('REMOVE_COMPOSER_SKILL_COMMAND')

export class ComposerSkillNode extends DecoratorNode<ReactNode> {
  __skill: SessionSkillReference

  static getType(): string {
    return 'composer-skill'
  }

  static clone(node: ComposerSkillNode): ComposerSkillNode {
    return new ComposerSkillNode(node.__skill, node.__key)
  }

  static importJSON(serializedNode: SerializedComposerSkillNode): ComposerSkillNode {
    return $createComposerSkillNode(serializedNode.skill).updateFromJSON(serializedNode)
  }

  constructor(skill: SessionSkillReference, key?: NodeKey) {
    super(key)
    this.__skill = skill
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

  exportJSON(): SerializedComposerSkillNode {
    return {
      ...super.exportJSON(),
      skill: this.__skill,
    }
  }

  getTextContent(): string {
    return `/skill:${this.getLatest().__skill.name}`
  }

  getSkill(): SessionSkillReference {
    return this.getLatest().__skill
  }

  setSkill(skill: SessionSkillReference): this {
    const writable = this.getWritable()
    writable.__skill = skill
    return writable
  }

  decorate(editor: LexicalEditor): ReactNode {
    return (
      <SkillReference
        skill={this.__skill}
        onRemove={() => editor.dispatchCommand(removeComposerSkillCommand, this.getKey())}
      />
    )
  }
}

export function $createComposerSkillNode(skill: SessionSkillReference): ComposerSkillNode {
  return $applyNodeReplacement(new ComposerSkillNode(skill))
}

export function $isComposerSkillNode(node: LexicalNode | null | undefined): node is ComposerSkillNode {
  return node instanceof ComposerSkillNode
}

export function $getComposerSkillNode(key: NodeKey): ComposerSkillNode | undefined {
  const node = $getNodeByKey(key)
  return $isComposerSkillNode(node) ? node : undefined
}
