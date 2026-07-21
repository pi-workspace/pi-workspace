import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'
import { sessionId } from '@/src/domain/session'
import type { ManagedSessionRuntimePolicy } from '@/src/domain/managed-session'
import { createManagedSessionServices } from './managed-session-resources'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

test('managed Sessions load normal global and Workspace Repository resources', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-workspace-managed-resources-'))
  const agentDir = join(root, 'agent')
  const cwd = join(root, 'managed-cwd')
  const repositoryPath = join(root, 'repository')
  temporaryDirectories.push(root)
  await Promise.all([
    mkdir(join(agentDir, 'extensions'), { recursive: true }),
    mkdir(join(repositoryPath, '.pi', 'skills', 'repository-skill'), { recursive: true }),
    mkdir(join(repositoryPath, '.pi', 'prompts'), { recursive: true }),
    mkdir(cwd, { recursive: true }),
  ])
  await writeFile(join(agentDir, 'settings.json'), JSON.stringify({ defaultProvider: 'example' }))
  await writeFile(
    join(agentDir, 'extensions', 'trusted.ts'),
    "export default function (pi) { pi.registerTool({ name: 'trusted_tool', label: 'Trusted', description: 'Trusted tool', parameters: { type: 'object', properties: {} }, async execute() { return { content: [{ type: 'text', text: 'ok' }], details: {} } } }) }\n"
  )
  await writeFile(
    join(repositoryPath, '.pi', 'skills', 'repository-skill', 'SKILL.md'),
    '---\nname: repository-skill\ndescription: Repository guidance\n---\n\nUse Repository guidance.\n'
  )
  await writeFile(join(repositoryPath, '.pi', 'prompts', 'review.md'), '---\ndescription: Review it\n---\nReview it.\n')
  await writeFile(join(repositoryPath, 'AGENTS.md'), '# Repository instructions\n')

  const policy: ManagedSessionRuntimePolicy = {
    workspaceId: 'workspace-a',
    workstreamId: 'workstream-a',
    sessionId: sessionId('session-a'),
    mode: 'brainstorm',
    lifecycle: 'active',
    repositories: [
      {
        id: 'repository-a',
        name: 'Repository',
        workingPath: repositoryPath,
        commonDirectoryPath: join(repositoryPath, '.git'),
        availability: 'available',
        role: '',
        relationships: [],
      },
    ],
    piSessionPath: join(root, 'session.jsonl'),
    resourcePolicyRevision: 1,
  }

  const services = await createManagedSessionServices(cwd, policy, 'Managed methodology.', { agentDir })

  assert.equal(services.settingsManager.getGlobalSettings().defaultProvider, 'example')
  assert.equal(services.resourceLoader.getExtensions().extensions.length, 1)
  assert.ok(services.resourceLoader.getSkills().skills.some(({ name }) => name === 'repository-skill'))
  assert.ok(services.resourceLoader.getPrompts().prompts.some(({ name }) => name === 'review'))
  assert.ok(
    services.resourceLoader
      .getAgentsFiles()
      .agentsFiles.some(
        ({ path, content }) => path === join(repositoryPath, 'AGENTS.md') && content.includes('Repository instructions')
      )
  )
  assert.ok(services.resourceLoader.getAppendSystemPrompt().includes('Managed methodology.'))
  assert.ok(services.resourceLoader.getExtensions().extensions[0]?.tools.has('trusted_tool'))
})

test('managed Sessions ignore resources from unavailable Workspace Repositories', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-workspace-managed-resources-'))
  const agentDir = join(root, 'agent')
  const cwd = join(root, 'managed-cwd')
  const repositoryPath = join(root, 'unavailable-repository')
  temporaryDirectories.push(root)
  await Promise.all([
    mkdir(agentDir, { recursive: true }),
    mkdir(cwd, { recursive: true }),
    mkdir(join(repositoryPath, '.pi', 'extensions'), { recursive: true }),
    mkdir(join(repositoryPath, '.pi', 'skills', 'unavailable-skill'), { recursive: true }),
  ])
  await Promise.all([
    writeFile(
      join(repositoryPath, '.pi', 'extensions', 'unavailable.ts'),
      "export default function (pi) { pi.registerTool({ name: 'unavailable_tool', label: 'Unavailable', description: 'Unavailable tool', parameters: { type: 'object', properties: {} }, async execute() { return { content: [{ type: 'text', text: 'no' }], details: {} } } }) }\n"
    ),
    writeFile(
      join(repositoryPath, '.pi', 'skills', 'unavailable-skill', 'SKILL.md'),
      '---\nname: unavailable-skill\ndescription: Unavailable guidance\n---\n\nDo not load this.\n'
    ),
  ])

  const policy: ManagedSessionRuntimePolicy = {
    workspaceId: 'workspace-a',
    workstreamId: 'workstream-a',
    sessionId: sessionId('session-a'),
    mode: 'brainstorm',
    lifecycle: 'active',
    repositories: [
      {
        id: 'repository-a',
        name: 'Unavailable Repository',
        commonDirectoryPath: join(repositoryPath, '.git'),
        availability: 'unavailable',
        role: '',
        relationships: [],
      },
    ],
    piSessionPath: join(root, 'session.jsonl'),
    resourcePolicyRevision: 1,
  }

  const services = await createManagedSessionServices(cwd, policy, 'Managed methodology.', { agentDir })

  assert.equal(services.resourceLoader.getExtensions().extensions.length, 0)
  assert.equal(
    services.resourceLoader.getSkills().skills.some(({ name }) => name === 'unavailable-skill'),
    false
  )
})
