import { access, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { CURRENT_SESSION_VERSION } from '@earendil-works/pi-coding-agent'
import { ensurePrivateDirectory, ensurePrivateFile } from '@/src/main/private-storage'

export type PiSessionCreationIntent = Readonly<{
  piSessionId: string
  directoryPath: string
  sessionPath: string
}>

export type OwnedPiSessionLocation = Readonly<{
  directoryPath: string
  sessionPath: string
}>

export type PiSessionFileCreationOutcome = Readonly<{ status: 'available' | 'quarantined' }>

export interface PiSessionFileStore {
  intent(piSessionId: string): PiSessionCreationIntent
  create(intent: PiSessionCreationIntent): Promise<PiSessionFileCreationOutcome>
  resolve(intent: PiSessionCreationIntent): Promise<OwnedPiSessionLocation | undefined>
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export async function createPiSessionFileStore(storageDirectory: string): Promise<PiSessionFileStore> {
  const directoryPath = join(storageDirectory, 'session-cwd')
  const sessionsDirectory = join(storageDirectory, 'sessions')
  const quarantineDirectory = join(storageDirectory, 'session-quarantine')

  await Promise.all([
    ensurePrivateDirectory(directoryPath),
    ensurePrivateDirectory(sessionsDirectory),
    ensurePrivateDirectory(quarantineDirectory),
  ])

  function intent(piSessionId: string): PiSessionCreationIntent {
    return {
      piSessionId,
      directoryPath,
      sessionPath: join(sessionsDirectory, `${piSessionId}.jsonl`),
    }
  }

  async function resolve(creationIntent: PiSessionCreationIntent): Promise<OwnedPiSessionLocation | undefined> {
    try {
      await ensurePrivateFile(creationIntent.sessionPath)
      const content = await readFile(creationIntent.sessionPath, 'utf8')
      const lines = content.split('\n').filter((line) => line.trim().length > 0)
      const entries = lines.map((line) => JSON.parse(line) as unknown)
      const header = entries[0]

      if (
        typeof header !== 'object' ||
        header === null ||
        (header as { type?: unknown }).type !== 'session' ||
        (header as { version?: unknown }).version !== CURRENT_SESSION_VERSION ||
        (header as { id?: unknown }).id !== creationIntent.piSessionId ||
        typeof (header as { timestamp?: unknown }).timestamp !== 'string' ||
        !Number.isFinite(Date.parse((header as { timestamp: string }).timestamp)) ||
        (header as { cwd?: unknown }).cwd !== creationIntent.directoryPath
      ) {
        return undefined
      }

      return {
        directoryPath: creationIntent.directoryPath,
        sessionPath: creationIntent.sessionPath,
      }
    } catch {
      return undefined
    }
  }

  async function quarantine(path: string, piSessionId: string): Promise<void> {
    const preferredPath = join(quarantineDirectory, `${piSessionId}.jsonl`)
    const quarantinePath = (await fileExists(preferredPath))
      ? join(quarantineDirectory, `${piSessionId}-${Date.now()}.jsonl`)
      : preferredPath

    await rename(path, quarantinePath)
  }

  async function create(creationIntent: PiSessionCreationIntent): Promise<PiSessionFileCreationOutcome> {
    const quarantinedPath = join(quarantineDirectory, `${creationIntent.piSessionId}.jsonl`)

    if (await fileExists(creationIntent.sessionPath)) {
      if (await resolve(creationIntent)) return { status: 'available' }

      await quarantine(creationIntent.sessionPath, creationIntent.piSessionId)
      return { status: 'quarantined' }
    }

    if (await fileExists(quarantinedPath)) return { status: 'quarantined' }

    const header = {
      type: 'session',
      version: CURRENT_SESSION_VERSION,
      id: creationIntent.piSessionId,
      timestamp: new Date().toISOString(),
      cwd: creationIntent.directoryPath,
    }

    await writeFile(creationIntent.sessionPath, `${JSON.stringify(header)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    })

    return { status: 'available' }
  }

  return { intent, create, resolve }
}
