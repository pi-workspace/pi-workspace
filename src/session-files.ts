import type { SessionId } from '@/src/domain/session'

export type SessionFile = Readonly<{
  path: string
  kind: 'file' | 'folder'
  name: string
}>

export type SessionFileReference = Readonly<{
  path: string
  kind: 'file' | 'folder'
  availability: 'available' | 'unavailable'
}>

export type SessionFileSelection = Readonly<{
  path: string
  offset: number
  tokenLength: number
}>

export type SessionFileMention = Readonly<{
  file: SessionFileReference
  offset: number
}>

export interface SessionFilesBridge {
  getAvailable(sessionId: SessionId, query?: string): Promise<readonly SessionFile[]>
}

export type SessionFileToken = Readonly<{
  path: string
  startOffset: number
  endOffset: number
}>

const trailingPathPunctuation = new Set([',', '.', ';', ':', '!', '?', ')', '}', ']'])
const unquotedPathPattern = /^[^\s@]*[^\s@,.;:!?)}\]]$/

/** Canonical form used in persisted messages and Agent prompts. */
export function sessionFileToken(path: string): string {
  return unquotedPathPattern.test(path) ? `@${path}` : `@@${JSON.stringify(path)}`
}

function quotedToken(source: string, startOffset: number, quoteOffset: number): SessionFileToken | undefined {
  let offset = quoteOffset + 1
  let escaped = false

  while (offset < source.length) {
    const character = source[offset]
    if (escaped) {
      escaped = false
      offset += 1
      continue
    }
    if (character === '\\') {
      escaped = true
      offset += 1
      continue
    }
    if (character === '"') {
      const token = source.slice(quoteOffset, offset + 1)

      try {
        const path = JSON.parse(token)
        return typeof path === 'string' && path.length > 0 ? { path, startOffset, endOffset: offset + 1 } : undefined
      } catch {
        return undefined
      }
    }

    offset += 1
  }

  return undefined
}

function unquotedToken(source: string, startOffset: number): SessionFileToken | undefined {
  let endOffset = startOffset + 1
  while (endOffset < source.length && !/\s|@/.test(source[endOffset] ?? '')) endOffset += 1

  while (endOffset > startOffset + 1 && trailingPathPunctuation.has(source[endOffset - 1] ?? '')) endOffset -= 1
  if (endOffset === startOffset + 1) return undefined

  return { path: source.slice(startOffset + 1, endOffset), startOffset, endOffset }
}

export function findSessionFileTokens(source: string): readonly SessionFileToken[] {
  const tokens: SessionFileToken[] = []

  for (let startOffset = 0; startOffset < source.length; startOffset += 1) {
    if (source[startOffset] !== '@' || source[startOffset - 1]?.match(/\S/)) continue

    let token: SessionFileToken | undefined
    if (source[startOffset + 1] === '@') {
      token = source[startOffset + 2] === '"' ? quotedToken(source, startOffset, startOffset + 2) : undefined
    } else {
      token = unquotedToken(source, startOffset)
    }
    if (!token) continue

    tokens.push(token)
    startOffset = token.endOffset - 1
  }

  return tokens
}

export function projectSessionFileSelections(source: string): Readonly<{
  text: string
  selections: readonly SessionFileSelection[]
}> {
  const selections: SessionFileSelection[] = []
  let text = ''
  let sourceOffset = 0

  for (const token of findSessionFileTokens(source)) {
    text += source.slice(sourceOffset, token.startOffset)
    selections.push({ path: token.path, offset: text.length, tokenLength: token.endOffset - token.startOffset })
    sourceOffset = token.endOffset
  }

  return { text: text + source.slice(sourceOffset), selections }
}

export function replaceSessionFileTokens(
  source: string,
  replacement: (path: string) => string | undefined
): string | undefined {
  let text = ''
  let sourceOffset = 0

  for (const token of findSessionFileTokens(source)) {
    const value = replacement(token.path)
    if (value === undefined) return undefined

    text += source.slice(sourceOffset, token.startOffset) + value
    sourceOffset = token.endOffset
  }

  return text + source.slice(sourceOffset)
}

export async function replaceSessionFileTokensAsync(
  source: string,
  replacement: (path: string) => Promise<string | undefined>
): Promise<string | undefined> {
  let text = ''
  let sourceOffset = 0

  for (const token of findSessionFileTokens(source)) {
    const value = await replacement(token.path)
    if (value === undefined) return undefined

    text += source.slice(sourceOffset, token.startOffset) + value
    sourceOffset = token.endOffset
  }

  return text + source.slice(sourceOffset)
}

export function sessionFileReference(file: SessionFile, available = true): SessionFileReference {
  return { path: file.path, kind: file.kind, availability: available ? 'available' : 'unavailable' }
}
