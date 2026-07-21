import { access } from 'node:fs/promises'
import { join } from 'node:path'
import {
  DefaultResourceLoader,
  getAgentDir,
  loadProjectContextFiles,
  SettingsManager,
  type ResourceLoader,
} from '@earendil-works/pi-coding-agent'
import type { ManagedSessionRuntimePolicy } from '@/src/domain/managed-session'

export type ManagedSessionServices = Readonly<{
  resourceLoader: ResourceLoader
  settingsManager: SettingsManager
}>

type ManagedSessionServicesOptions = Readonly<{ agentDir?: string }>

export async function createManagedSessionServices(
  cwd: string,
  policy: ManagedSessionRuntimePolicy,
  methodology: string,
  options: ManagedSessionServicesOptions = {}
): Promise<ManagedSessionServices> {
  const agentDir = options.agentDir ?? getAgentDir()
  const settingsManager = SettingsManager.create(cwd, agentDir)
  const repositoryPaths = policy.repositories
    .filter((repository) => repository.availability === 'available')
    .map((repository) => repository.workingPath)
  const [additionalExtensionPaths, additionalSkillPaths, additionalPromptTemplatePaths, additionalThemePaths] =
    await Promise.all([
      existingPaths(repositoryPaths.map((path) => join(path, '.pi', 'extensions'))),
      existingPaths(repositoryPaths.flatMap((path) => [join(path, '.pi', 'skills'), join(path, '.agents', 'skills')])),
      existingPaths(repositoryPaths.map((path) => join(path, '.pi', 'prompts'))),
      existingPaths(repositoryPaths.map((path) => join(path, '.pi', 'themes'))),
    ])
  const repositoryContextFiles = repositoryPaths.flatMap((repositoryPath) =>
    loadProjectContextFiles({ cwd: repositoryPath, agentDir })
  )
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    additionalExtensionPaths,
    additionalSkillPaths,
    additionalPromptTemplatePaths,
    additionalThemePaths,
    agentsFilesOverride: ({ agentsFiles }) => ({
      agentsFiles: deduplicateContextFiles([...agentsFiles, ...repositoryContextFiles]),
    }),
    appendSystemPromptOverride: (prompts) => [...prompts, methodology],
  })

  await resourceLoader.reload()

  return { resourceLoader, settingsManager }
}

async function existingPaths(paths: readonly string[]): Promise<string[]> {
  const exists = await Promise.all(
    paths.map((path) =>
      access(path).then(
        () => true,
        () => false
      )
    )
  )

  return paths.filter((_path, index) => exists[index])
}

function deduplicateContextFiles(
  files: readonly Readonly<{ path: string; content: string }>[]
): Array<{ path: string; content: string }> {
  return [...new Map(files.map((file) => [file.path, file])).values()]
}
