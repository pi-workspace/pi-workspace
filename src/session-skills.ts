import type { SessionId } from '@/src/domain/session'

export type SessionSkill = Readonly<{
  name: string
  description: string
}>

export type SessionSkillReference =
  | Readonly<{
      name: string
      description: string
      availability: 'available'
    }>
  | Readonly<{
      name: string
      availability: 'unavailable'
    }>

export type SessionSkillSelection = Readonly<{
  name: string
  offset: number
}>

export type SessionSkillMention = Readonly<{
  skill: SessionSkillReference
  offset: number
}>

const sessionSkillTokenPattern = /(?<!\S)\/skill:([a-z0-9]+(?:-[a-z0-9]+)*)(?![a-z0-9-])/g

export function projectSessionSkillSelections(source: string): Readonly<{
  text: string
  selections: readonly SessionSkillSelection[]
}> {
  const selections: SessionSkillSelection[] = []
  let text = ''
  let sourceOffset = 0

  for (const match of source.matchAll(sessionSkillTokenPattern)) {
    const token = match[0]
    const name = match[1]
    const matchOffset = match.index
    if (!token || !name || matchOffset === undefined) continue

    text += source.slice(sourceOffset, matchOffset)
    selections.push({ name, offset: text.length })
    sourceOffset = matchOffset + token.length
  }

  return { text: text + source.slice(sourceOffset), selections }
}

export function replaceSessionSkillTokens(
  source: string,
  replacement: (name: string) => string | undefined
): string | undefined {
  let valid = true
  const result = source.replace(sessionSkillTokenPattern, (_token, name: string) => {
    const value = replacement(name)
    if (value === undefined) valid = false
    return value ?? ''
  })

  return valid ? result : undefined
}

export interface SessionSkillsBridge {
  getAvailable(sessionId: SessionId): Promise<readonly SessionSkill[]>
}
