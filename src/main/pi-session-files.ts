import { randomUUID } from 'node:crypto'
import { access, mkdtemp, open, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { CURRENT_SESSION_VERSION, SessionManager } from '@earendil-works/pi-coding-agent'
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

export type PiSessionForkIntent = PiSessionCreationIntent &
  Readonly<{
    sourceSessionPath: string
    sourceEntryId: string
    title: string
    contextMessage?: string
  }>

export type PiSessionFileCreationOutcome = Readonly<{ status: 'available' | 'quarantined' }>

export interface PiSessionFileStore {
  intent(piSessionId: string): PiSessionCreationIntent
  create(intent: PiSessionCreationIntent): Promise<PiSessionFileCreationOutcome>
  fork(intent: PiSessionForkIntent): Promise<PiSessionFileCreationOutcome>
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
  const stagingDirectory = join(storageDirectory, 'session-staging')

  await Promise.all([
    ensurePrivateDirectory(directoryPath),
    ensurePrivateDirectory(sessionsDirectory),
    ensurePrivateDirectory(quarantineDirectory),
    ensurePrivateDirectory(stagingDirectory),
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
      const file = await open(creationIntent.sessionPath, 'r')
      let header: unknown

      try {
        for await (const line of file.readLines()) {
          if (!line.trim()) continue

          header = JSON.parse(line) as unknown
          break
        }
      } finally {
        await file.close()
      }

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

  function finalizeForkFile(forkIntent: PiSessionForkIntent): void {
    const targetManager = SessionManager.open(forkIntent.sessionPath, undefined)
    const queuedFollowUpIds = new Set<string>()
    let hasContextMessage = false

    for (const entry of targetManager.getBranch()) {
      if (
        entry.type === 'custom_message' &&
        entry.customType === 'pi-workspace.session-fork' &&
        entry.content === forkIntent.contextMessage
      ) {
        hasContextMessage = true
      }
      if (
        entry.type !== 'custom' ||
        entry.customType !== 'pi-workspace.activity-layer' ||
        typeof entry.data !== 'object' ||
        entry.data === null
      ) {
        continue
      }

      const record = entry.data as {
        type?: unknown
        followUp?: { id?: unknown }
        followUpId?: unknown
      }
      if (record.type === 'queued-follow-up' && typeof record.followUp?.id === 'string') {
        queuedFollowUpIds.add(record.followUp.id)
      }
      if (record.type === 'queued-follow-up-removed' && typeof record.followUpId === 'string') {
        queuedFollowUpIds.delete(record.followUpId)
      }
    }

    for (const followUpId of queuedFollowUpIds) {
      targetManager.appendCustomEntry('pi-workspace.activity-layer', {
        version: 1,
        type: 'queued-follow-up-removed',
        followUpId,
      })
    }
    if (targetManager.getSessionName() !== forkIntent.title) {
      targetManager.appendSessionInfo(forkIntent.title)
    }
    if (forkIntent.contextMessage && !hasContextMessage) {
      targetManager.appendCustomMessageEntry('pi-workspace.session-fork', forkIntent.contextMessage, false)
    }
  }

  async function fork(forkIntent: PiSessionForkIntent): Promise<PiSessionFileCreationOutcome> {
    if (await fileExists(forkIntent.sessionPath)) {
      if (await resolve(forkIntent)) {
        finalizeForkFile(forkIntent)
        return { status: 'available' }
      }

      await quarantine(forkIntent.sessionPath, forkIntent.piSessionId)
      return { status: 'quarantined' }
    }

    const sourceManager = SessionManager.open(forkIntent.sourceSessionPath, undefined)
    const selectedEntry = sourceManager.getEntry(forkIntent.sourceEntryId)
    const selectedOnActiveBranch = sourceManager.getBranch().some((entry) => entry.id === forkIntent.sourceEntryId)

    if (!selectedOnActiveBranch || selectedEntry?.type !== 'message' || selectedEntry.message.role !== 'user') {
      throw new TypeError('Select a user message from the current Session history.')
    }

    const temporaryDirectory = await mkdtemp(join(stagingDirectory, 'fork-'))
    const temporaryPath = `${forkIntent.sessionPath}.${randomUUID()}.tmp`

    try {
      let header: Record<string, unknown>
      let entries: readonly unknown[]

      if (selectedEntry.parentId === null) {
        header = {
          type: 'session',
          version: CURRENT_SESSION_VERSION,
          id: forkIntent.piSessionId,
          timestamp: new Date().toISOString(),
          cwd: forkIntent.directoryPath,
          parentSession: forkIntent.sourceSessionPath,
        }
        entries = []
      } else {
        const branchManager = SessionManager.open(forkIntent.sourceSessionPath, temporaryDirectory)
        branchManager.createBranchedSession(selectedEntry.parentId)
        const branchedHeader = branchManager.getHeader()

        if (!branchedHeader) throw new Error('Pi could not create the forked Session history.')

        header = {
          ...branchedHeader,
          id: forkIntent.piSessionId,
          cwd: forkIntent.directoryPath,
          parentSession: forkIntent.sourceSessionPath,
        }
        entries = branchManager.getEntries()
      }

      const content = [header, ...entries].map((entry) => JSON.stringify(entry)).join('\n') + '\n'
      await writeFile(temporaryPath, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
      await rename(temporaryPath, forkIntent.sessionPath)
      await ensurePrivateFile(forkIntent.sessionPath)

      finalizeForkFile(forkIntent)

      return { status: 'available' }
    } finally {
      await Promise.all([rm(temporaryDirectory, { recursive: true, force: true }), rm(temporaryPath, { force: true })])
    }
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

  return { intent, create, fork, resolve }
}
