import type { ReactNode } from 'react'
import { FileReference } from '@/src/renderer/components/file-reference'
import { SkillReference } from '@/src/renderer/components/skill-reference'
import type { SessionFileMention } from '@/src/session-files'
import type { SessionSkillMention } from '@/src/session-skills'

type ReferenceMentionTextProperties = Readonly<{
  text: string
  skills: readonly SessionSkillMention[]
  files: readonly SessionFileMention[]
}>

type Mention =
  | Readonly<{ offset: number; type: 'skill'; value: SessionSkillMention['skill']; index: number }>
  | Readonly<{ offset: number; type: 'file'; value: SessionFileMention['file']; index: number }>

export function ReferenceMentionText({ text, skills, files }: ReferenceMentionTextProperties) {
  const mentions: Mention[] = [
    ...skills.map((mention, index) => ({
      offset: mention.offset,
      type: 'skill' as const,
      value: mention.skill,
      index,
    })),
    ...files.map((mention, index) => ({ offset: mention.offset, type: 'file' as const, value: mention.file, index })),
  ].sort((left, right) => left.offset - right.offset)
  const content: ReactNode[] = []
  let textOffset = 0

  for (const mention of mentions) {
    content.push(text.slice(textOffset, mention.offset))
    content.push(
      mention.type === 'skill' ? (
        <SkillReference key={`skill:${mention.offset}:${mention.index}`} skill={mention.value} />
      ) : (
        <FileReference key={`file:${mention.offset}:${mention.index}`} file={mention.value} />
      )
    )
    textOffset = mention.offset
  }

  content.push(text.slice(textOffset))
  return content
}
