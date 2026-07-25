import type { ReactNode } from 'react'
import type { SessionSkillMention } from '@/src/session-skills'
import { SkillReference } from './skill-reference'

type SkillMentionTextProperties = Readonly<{
  text: string
  skills: readonly SessionSkillMention[]
}>

export function SkillMentionText({ text, skills }: SkillMentionTextProperties) {
  const content: ReactNode[] = []
  let textOffset = 0

  for (const [index, mention] of skills.entries()) {
    content.push(text.slice(textOffset, mention.offset))
    content.push(<SkillReference key={`${mention.offset}:${mention.skill.name}:${index}`} skill={mention.skill} />)
    textOffset = mention.offset
  }

  content.push(text.slice(textOffset))
  return content
}
