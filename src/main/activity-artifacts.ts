import { isAbsolute, normalize, relative, sep } from 'node:path'
import type { ActivityArtifact, ToolExecution } from '@/src/session-timeline'

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
  isError: boolean
): readonly ActivityArtifact[] {
  const artifacts: ActivityArtifact[] = []
  const path = normalizedRuntimePath(execution.input, runtimeDirectory)

  if (!isError && path && inspectedToolNames.has(execution.toolName)) {
    artifacts.push({ type: 'inspected-file', path })
  }

  if (!isError && path && changedToolNames.has(execution.toolName)) {
    artifacts.push({ type: 'file-change', path, ...patchCounts(result) })
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
      artifact.type === 'inspected-file' || artifact.type === 'file-change' ? [artifact.path] : []
    )
  ).size
}

function normalizedRuntimePath(input: unknown, runtimeDirectory: string): string | undefined {
  const path = suppliedPath(input)

  if (!path) return undefined

  const runtimePath = isAbsolute(path) ? relative(runtimeDirectory, path) : normalize(path)

  if (runtimePath === '..' || runtimePath.startsWith(`..${sep}`) || isAbsolute(runtimePath)) return undefined

  return runtimePath.split(sep).join('/')
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
  if (artifact.type === 'inspected-file' || artifact.type === 'file-change') return `${artifact.type}:${artifact.path}`
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
