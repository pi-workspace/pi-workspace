import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import { extname, relative, resolve, sep } from 'node:path'
import type { SessionFile, SessionFileReference } from '@/src/session-files'

const maximumCandidates = 50
const maximumTraversalEntries = 2_000
const maximumFileBytes = 50_000
const maximumFolderEntries = 100

export type SessionFileRoot = Readonly<{
  path: string
  prefix?: string
}>

type SessionFileRoots = string | readonly SessionFileRoot[]

function normalizedRoots(roots: SessionFileRoots): readonly SessionFileRoot[] {
  return typeof roots === 'string' ? [{ path: roots }] : roots
}

function isWithin(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${sep}`)
}

function isTaggedPathSyntaxValid(path: string): boolean {
  return path.length > 0 && !path.startsWith('/') && !path.includes('\\') && !path.split('/').includes('..')
}

async function resolveTaggedPath(
  root: string,
  path: string
): Promise<Readonly<{ absolutePath: string; relativePath: string }> | undefined> {
  if (!isTaggedPathSyntaxValid(path)) return undefined

  const rootPath = await realpath(root)
  const absolutePath = resolve(rootPath, path)
  if (!isWithin(rootPath, absolutePath)) return undefined

  try {
    const resolvedPath = await realpath(absolutePath)
    if (!isWithin(rootPath, resolvedPath)) return undefined

    return { absolutePath: resolvedPath, relativePath: relative(rootPath, resolvedPath) }
  } catch {
    return undefined
  }
}

function rootForTaggedPath(
  roots: SessionFileRoots,
  path: string
): Readonly<{ root: string; path: string; displayPath: string }> | undefined {
  for (const candidate of normalizedRoots(roots)) {
    if (!candidate.prefix) return { root: candidate.path, path, displayPath: path }
    if (path.startsWith(`${candidate.prefix}/`)) {
      return { root: candidate.path, path: path.slice(candidate.prefix.length + 1), displayPath: path }
    }
  }

  return undefined
}

function isBinary(contents: Buffer): boolean {
  return contents.includes(0)
}

function language(path: string): string {
  const extension = extname(path).slice(1)
  return /^[a-z0-9_-]+$/i.test(extension) ? extension : 'text'
}

function MarkdownCode(value: string): string {
  const longestDelimiter = Math.max(0, ...(value.match(/`+/g) ?? []).map((delimiter) => delimiter.length))
  const delimiter = '`'.repeat(longestDelimiter + 1)

  return `${delimiter}${value}${delimiter}`
}

function markdownCodeFence(value: string): string {
  const longestDelimiter = Math.max(0, ...(value.match(/`+/g) ?? []).map((delimiter) => delimiter.length))
  return '`'.repeat(Math.max(3, longestDelimiter + 1))
}

function candidateRank(candidate: SessionFile, query: string): number {
  const path = candidate.path.toLowerCase()
  const name = candidate.name.toLowerCase()
  if (path === query || name === query) return 0
  if (path.startsWith(query) || name.startsWith(query)) return 1
  return 2
}

export async function findSessionFiles(roots: SessionFileRoots, query = ''): Promise<readonly SessionFile[]> {
  const normalizedQuery = query.toLowerCase()
  const candidates: SessionFile[] = []

  for (const root of normalizedRoots(roots)) {
    const pending = ['']
    let visited = 0

    while (pending.length > 0 && candidates.length < maximumCandidates && visited < maximumTraversalEntries) {
      const directory = pending.shift()
      if (directory === undefined) break

      let entries
      try {
        entries = await readdir(resolve(root.path, directory), { withFileTypes: true })
      } catch {
        continue
      }

      for (const entry of entries) {
        visited += 1
        if (entry.name === '.git' || visited > maximumTraversalEntries) continue

        const relativePath = directory ? `${directory}/${entry.name}` : entry.name
        const path = root.prefix ? `${root.prefix}/${relativePath}` : relativePath
        const kind = entry.isDirectory() ? 'folder' : 'file'
        const searchable = `${path} ${entry.name}`.toLowerCase()

        if (normalizedQuery.length === 0 || searchable.includes(normalizedQuery)) {
          candidates.push({ path, name: entry.name, kind })
        }
        if (entry.isDirectory()) pending.push(relativePath)
        if (candidates.length >= maximumCandidates) break
      }
    }
  }

  return candidates.sort(
    (left, right) =>
      candidateRank(left, normalizedQuery) - candidateRank(right, normalizedQuery) ||
      left.path.localeCompare(right.path)
  )
}

export async function getSessionFileReference(roots: SessionFileRoots, path: string): Promise<SessionFileReference> {
  const selectedRoot = rootForTaggedPath(roots, path)
  if (!selectedRoot) return { path, kind: 'file', availability: 'unavailable' }

  const taggedPath = await resolveTaggedPath(selectedRoot.root, selectedRoot.path)
  if (!taggedPath) return { path, kind: 'file', availability: 'unavailable' }

  try {
    const details = await stat(taggedPath.absolutePath)
    return {
      path,
      kind: details.isDirectory() ? 'folder' : 'file',
      availability: details.isFile() || details.isDirectory() ? 'available' : 'unavailable',
    }
  } catch {
    return { path, kind: 'file', availability: 'unavailable' }
  }
}

export async function renderSessionFileContext(roots: SessionFileRoots, path: string): Promise<string | undefined> {
  if (!isTaggedPathSyntaxValid(path)) return undefined

  const selectedRoot = rootForTaggedPath(roots, path)
  if (!selectedRoot) return `## Referenced path unavailable: ${MarkdownCode(path)}`

  const taggedPath = await resolveTaggedPath(selectedRoot.root, selectedRoot.path)
  if (!taggedPath) return `## Referenced path unavailable: ${MarkdownCode(path)}`

  let details
  try {
    details = await stat(taggedPath.absolutePath)
  } catch {
    return `## Referenced path unavailable: ${MarkdownCode(path)}`
  }

  if (details.isDirectory()) {
    let entries
    try {
      entries = await readdir(taggedPath.absolutePath, { withFileTypes: true })
    } catch {
      return `## Referenced path unavailable: ${MarkdownCode(path)}`
    }
    const listing = entries
      .filter((entry) => entry.name !== '.git')
      .slice(0, maximumFolderEntries)
      .map((entry) => `- ${MarkdownCode(`${entry.name}${entry.isDirectory() ? '/' : ''}`)}`)
      .join('\n')
    const suffix = entries.length > maximumFolderEntries ? '\n- …' : ''

    return `## Referenced folder: ${MarkdownCode(path)}\n\n${listing}${suffix}`
  }
  if (!details.isFile() || details.size > maximumFileBytes)
    return `## Referenced path unavailable: ${MarkdownCode(path)}`

  let contents: Buffer
  try {
    contents = await readFile(taggedPath.absolutePath)
  } catch {
    return `## Referenced path unavailable: ${MarkdownCode(path)}`
  }
  if (isBinary(contents)) return `## Referenced path unavailable: ${MarkdownCode(path)}`

  const text = contents.toString('utf8')
  const fence = markdownCodeFence(text)

  return `## Referenced file: ${MarkdownCode(path)}\n\n${fence}${language(taggedPath.relativePath)}\n${text}\n${fence}`
}
