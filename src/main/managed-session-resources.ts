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

type SessionServices = Readonly<{
  resourceLoader: ResourceLoader
  settingsManager: SettingsManager
}>

type SessionServicesOptions = Readonly<{ agentDir?: string }>

const finalValidationGuidance = [
  'When a task changes a Repository, always perform a final validation pass before declaring the work complete.',
  'After the final workable Repository change, run the relevant local CI/CD checks, including GitHub Actions checks that can run locally.',
  'Do this once as a final self-check immediately before completion—and before pushing or creating a pull request—not after each turn or as a separate pull-request preparation step.',
  'Resolve failures caused by the changes before completing, and clearly report any remaining validation blockers.',
].join('\n')

export async function createDefaultSessionServices(
  cwd: string,
  options: SessionServicesOptions = {}
): Promise<SessionServices> {
  const agentDir = options.agentDir ?? getAgentDir()
  const settingsManager = SettingsManager.create(cwd, agentDir)
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    appendSystemPromptOverride: (prompts) => [...prompts, finalValidationGuidance],
  })

  await resourceLoader.reload()

  return { resourceLoader, settingsManager }
}

export async function createManagedSessionServices(
  cwd: string,
  policy: ManagedSessionRuntimePolicy,
  methodology: string,
  options: SessionServicesOptions = {}
): Promise<SessionServices> {
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
    appendSystemPromptOverride: (prompts) => [...prompts, methodology, finalValidationGuidance],
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
