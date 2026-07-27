import { isAbsolute, normalize, relative, sep } from 'node:path'
import type { ActivityArtifact, ActivityMutationPreview, ToolExecution } from '@/src/session-timeline'

export type ActivityRepositoryLocation = Readonly<{
  repositoryId: string
  workingPath: string
}>

const inspectedToolNames = new Set(['read', 'grep', 'find', 'ls', 'search'])
const changedToolNames = new Set(['edit', 'write', 'apply_patch'])
const commandToolNames = new Set(['bash', 'exec', 'shell', 'command'])
const pathToolNames = new Set(['read', 'write', 'edit', 'ls'])
const searchToolNames = new Set(['grep', 'find', 'search'])

export function deriveOperationInputPreview(
  toolName: string,
  input: unknown,
  runtimeDirectory: string
): string | undefined {
  if (commandToolNames.has(toolName)) return compactPreview(stringProperty(input, 'command'))

  if (pathToolNames.has(toolName)) {
    return compactPreview(normalizedRuntimePath(input, runtimeDirectory) ?? suppliedPath(input))
  }

  if (searchToolNames.has(toolName)) {
    const query = stringProperty(input, 'pattern') ?? stringProperty(input, 'query')
    const path = normalizedRuntimePath(input, runtimeDirectory) ?? suppliedPath(input)

    return compactPreview(query && path ? `${query} in ${path}` : (query ?? path))
  }

  if (toolName === 'apply_patch') return compactPreview(firstPatchPath(input))

  return compactPreview(
    normalizedRuntimePath(input, runtimeDirectory) ??
      suppliedPath(input) ??
      stringProperty(input, 'query') ??
      stringProperty(input, 'pattern') ??
      stringProperty(input, 'url')
  )
}

export function deriveActivityArtifacts(
  execution: ToolExecution,
  result: unknown,
  runtimeDirectory: string,
  isError: boolean,
  repositories: readonly ActivityRepositoryLocation[] = []
): readonly ActivityArtifact[] {
  const artifacts: ActivityArtifact[] = []
  const attributedPath = normalizedActivityPath(
    execution.input,
    runtimeDirectory,
    repositories,
    execution.toolName === 'apply_patch' ? firstPatchPath(execution.input) : undefined
  )
  const path = attributedPath?.path

  if (!isError && path && inspectedToolNames.has(execution.toolName)) {
    artifacts.push({ type: 'inspected-file', path })
  }

  if (!isError && path && changedToolNames.has(execution.toolName)) {
    artifacts.push({
      type: 'file-change',
      path,
      ...(attributedPath?.repositoryId ? { repositoryId: attributedPath.repositoryId } : {}),
      ...patchCounts(result),
    })
  }

  const command = stringProperty(execution.input, 'command')
  if (command && commandToolNames.has(execution.toolName)) {
    const status = isError ? 'failed' : 'completed'
    artifacts.push({
      type: 'command',
      command,
      status,
      rawResultReference: execution.rawResultReference,
    })

    const validationLabel = classifyValidation(command)

    if (validationLabel) artifacts.push({ type: 'validation', label: validationLabel, status })
  }

  return artifacts
}

export function deriveMutationPreview(
  execution: ToolExecution,
  result: unknown,
  runtimeDirectory: string,
  repositories: readonly ActivityRepositoryLocation[] = []
): ActivityMutationPreview | undefined {
  if (execution.status !== 'completed' || !changedToolNames.has(execution.toolName)) return undefined

  const attributedPath = normalizedActivityPath(
    execution.input,
    runtimeDirectory,
    repositories,
    execution.toolName === 'apply_patch' ? firstPatchPath(execution.input) : undefined
  )
  if (!attributedPath) return undefined

  const content =
    execution.toolName === 'write'
      ? stringProperty(execution.input, 'content')
      : stringProperty(objectProperty(result, 'details'), 'patch')
  if (content === undefined) return undefined

  const limit = 100_000
  const truncated = content.length > limit

  return {
    kind: execution.toolName === 'write' ? 'code' : 'diff',
    ...attributedPath,
    content: truncated ? `${content.slice(0, limit)}\n…` : content,
    truncated,
  }
}

export function mergeActivityArtifacts(
  current: readonly ActivityArtifact[],
  additions: readonly ActivityArtifact[]
): readonly ActivityArtifact[] {
  const next = [...current]

  for (const artifact of additions) {
    if (!next.some((candidate) => artifactKey(candidate) === artifactKey(artifact))) next.push(artifact)
  }

  return next
}

export function countArtifactFiles(artifacts: readonly ActivityArtifact[]): number {
  return new Set(
    artifacts.flatMap((artifact) =>
      artifact.type === 'inspected-file'
        ? [artifact.path]
        : artifact.type === 'file-change'
          ? [`${artifact.repositoryId ?? 'session'}:${artifact.path}`]
          : []
    )
  ).size
}

function normalizedRuntimePath(input: unknown, runtimeDirectory: string): string | undefined {
  return normalizedPath(suppliedPath(input), runtimeDirectory)
}

function normalizedActivityPath(
  input: unknown,
  runtimeDirectory: string,
  repositories: readonly ActivityRepositoryLocation[],
  suppliedActivityPath?: string
): Readonly<{ path: string; repositoryId?: string }> | undefined {
  const path = suppliedActivityPath ?? suppliedPath(input)
  if (!path) return undefined

  if (isAbsolute(path)) {
    for (const repository of repositories) {
      const repositoryPath = normalizedPath(path, repository.workingPath)
      if (repositoryPath) return { path: repositoryPath, repositoryId: repository.repositoryId }
    }
  }

  const runtimePath = normalizedPath(path, runtimeDirectory)
  return runtimePath ? { path: runtimePath } : undefined
}

function normalizedPath(path: string | undefined, rootPath: string): string | undefined {
  if (!path) return undefined

  const relativePath = isAbsolute(path) ? relative(rootPath, path) : normalize(path)
  if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) return undefined

  return relativePath.split(sep).join('/')
}

function suppliedPath(input: unknown): string | undefined {
  return stringProperty(input, 'path') ?? stringProperty(input, 'filePath') ?? stringProperty(input, 'file_path')
}

function firstPatchPath(input: unknown): string | undefined {
  const patch = stringProperty(input, 'patch') ?? (typeof input === 'string' ? input : undefined)
  return patch?.match(/^\*\*\* (?:Update|Add|Delete) File:\s*(.+)$/m)?.[1]
}

function patchCounts(result: unknown): { additions?: number; deletions?: number } {
  const patch = stringProperty(objectProperty(result, 'details'), 'patch')

  if (!patch) return {}

  let additions = 0
  let deletions = 0

  for (const line of patch.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue
    if (line.startsWith('+')) additions += 1
    if (line.startsWith('-')) deletions += 1
  }

  return { additions, deletions }
}

function classifyValidation(command: string): string | undefined {
  if (/\b(test|vitest|jest|pest)\b/.test(command)) return 'Tests'
  if (/\b(typecheck|tsc)\b/.test(command)) return 'Type check'
  if (/\blint\b/.test(command)) return 'Lint'
  if (/\bbuild\b/.test(command)) return 'Build'
  if (/\bgit\s+diff\b/.test(command)) return 'Diff inspection'
  return undefined
}

function artifactKey(artifact: ActivityArtifact): string {
  if (artifact.type === 'inspected-file') return `${artifact.type}:${artifact.path}`
  if (artifact.type === 'file-change') {
    return `${artifact.type}:${artifact.repositoryId ?? 'session'}:${artifact.path}`
  }
  if (artifact.type === 'command') return `${artifact.type}:${artifact.command}`
  return `${artifact.type}:${artifact.label}`
}

function stringProperty(value: unknown, key: string): string | undefined {
  const property = objectProperty(value, key)
  return typeof property === 'string' && property.length > 0 ? property : undefined
}

function objectProperty(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[key] : undefined
}

function compactPreview(value: string | undefined): string | undefined {
  const compact = value?.replace(/\s+/g, ' ').trim()
  return compact || undefined
}
