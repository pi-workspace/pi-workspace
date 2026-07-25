import assert from 'node:assert/strict'
import { access, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, test } from 'node:test'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import { createPiSessionFileStore } from './pi-session-files'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true, maxRetries: 5 }))
  )
})

async function assertPrivateMode(path: string, expectedMode: number): Promise<void> {
  if (process.platform === 'win32') return

  assert.equal((await stat(path)).mode & 0o777, expectedMode)
}

async function createStore() {
  const storageDirectory = await mkdtemp(join(tmpdir(), 'pi-workspace-session-files-'))
  temporaryDirectories.push(storageDirectory)

  return { storageDirectory, store: await createPiSessionFileStore(storageDirectory) }
}

test('forks history before a selected user message into a new app-owned Session', async () => {
  const { store } = await createStore()
  const sourceIntent = store.intent('source-session')
  const targetIntent = store.intent('forked-session')
  const timestamp = new Date().toISOString()
  const usage = {
    input: 1,
    output: 1,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 2,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  }
  await writeFile(
    sourceIntent.sessionPath,
    [
      { type: 'session', version: 3, id: 'source-session', timestamp, cwd: sourceIntent.directoryPath },
      {
        type: 'message',
        id: 'aaaa0001',
        parentId: null,
        timestamp,
        message: { role: 'user', content: 'Original request', timestamp: Date.now() },
      },
      {
        type: 'message',
        id: 'bbbb0002',
        parentId: 'aaaa0001',
        timestamp,
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Original response' }],
          api: 'openai-responses',
          provider: 'openai',
          model: 'test-model',
          usage,
          stopReason: 'stop',
          timestamp: Date.now(),
        },
      },
      {
        type: 'message',
        id: 'cccc0003',
        parentId: 'bbbb0002',
        timestamp,
        message: { role: 'user', content: 'Try another approach', timestamp: Date.now() },
      },
    ]
      .map((entry) => JSON.stringify(entry))
      .join('\n') + '\n',
    'utf8'
  )

  const outcome = await store.fork({
    ...targetIntent,
    sourceSessionPath: sourceIntent.sessionPath,
    sourceEntryId: 'cccc0003',
    title: 'Fork of original',
  })

  assert.deepEqual(outcome, { status: 'available' })
  const entries = (await readFile(targetIntent.sessionPath, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>)
  assert.deepEqual(entries[0], {
    type: 'session',
    version: 3,
    id: 'forked-session',
    timestamp: entries[0]?.timestamp,
    cwd: targetIntent.directoryPath,
    parentSession: sourceIntent.sessionPath,
  })
  assert.deepEqual(
    entries.flatMap((entry) =>
      entry.type === 'message' ? [(entry.message as { role: string; content: unknown }).content] : []
    ),
    ['Original request', [{ type: 'text', text: 'Original response' }]]
  )
  assert.equal(entries.at(-1)?.type, 'session_info')
  assert.equal(entries.at(-1)?.name, 'Fork of original')
  await assertPrivateMode(targetIntent.sessionPath, 0o600)
})

test('does not carry a pending Queued Follow-up into a forked Session', async () => {
  const { store } = await createStore()
  const sourceIntent = store.intent('source-queue-session')
  const targetIntent = store.intent('forked-queue-session')
  const timestamp = new Date().toISOString()
  const usage = {
    input: 1,
    output: 1,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 2,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  }
  await writeFile(
    sourceIntent.sessionPath,
    [
      { type: 'session', version: 3, id: 'source-queue-session', timestamp, cwd: sourceIntent.directoryPath },
      {
        type: 'message',
        id: 'aaaa0001',
        parentId: null,
        timestamp,
        message: { role: 'user', content: 'Original request', timestamp: Date.now() },
      },
      {
        type: 'message',
        id: 'bbbb0002',
        parentId: 'aaaa0001',
        timestamp,
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Original response' }],
          api: 'openai-responses',
          provider: 'openai',
          model: 'test-model',
          usage,
          stopReason: 'stop',
          timestamp: Date.now(),
        },
      },
      {
        type: 'custom',
        id: 'cccc0003',
        parentId: 'bbbb0002',
        timestamp,
        customType: 'pi-workspace.activity-layer',
        data: {
          version: 1,
          type: 'queued-follow-up',
          followUp: { id: 'follow-up-a', text: 'Do this later', createdAt: Date.now() },
        },
      },
      {
        type: 'message',
        id: 'dddd0004',
        parentId: 'cccc0003',
        timestamp,
        message: { role: 'user', content: 'Fork here', timestamp: Date.now() },
      },
    ]
      .map((entry) => JSON.stringify(entry))
      .join('\n') + '\n',
    'utf8'
  )

  await store.fork({
    ...targetIntent,
    sourceSessionPath: sourceIntent.sessionPath,
    sourceEntryId: 'dddd0004',
    title: 'Fork without queue',
  })

  const records = SessionManager.open(targetIntent.sessionPath)
    .getBranch()
    .flatMap((entry) =>
      entry.type === 'custom' && entry.customType === 'pi-workspace.activity-layer'
        ? [entry.data as { type?: string; followUpId?: string }]
        : []
    )
  assert.deepEqual(records.at(-1), { version: 1, type: 'queued-follow-up-removed', followUpId: 'follow-up-a' })
})

test('creates an app-owned Session at its deterministic path', async () => {
  const { store } = await createStore()
  const intent = store.intent('session-a')

  await store.create(intent)

  assert.equal(intent.sessionPath.endsWith(join('sessions', 'session-a.jsonl')), true)
  assert.deepEqual(await store.resolve(intent), {
    directoryPath: intent.directoryPath,
    sessionPath: intent.sessionPath,
  })
  await assertPrivateMode(intent.directoryPath, 0o700)
  await assertPrivateMode(dirname(intent.sessionPath), 0o700)
  await assertPrivateMode(intent.sessionPath, 0o600)
})

test('does not derive identity from a mismatched Session header', async () => {
  const { store } = await createStore()
  const intent = store.intent('session-a')
  await writeFile(
    intent.sessionPath,
    `${JSON.stringify({ type: 'session', version: 3, id: 'session-b', timestamp: new Date().toISOString(), cwd: intent.directoryPath })}\n`,
    'utf8'
  )

  assert.equal(await store.resolve(intent), undefined)
})

test('rejects a matching Session header with malformed metadata', async () => {
  const { store } = await createStore()
  const intent = store.intent('session-a')
  await writeFile(
    intent.sessionPath,
    `${JSON.stringify({ type: 'session', id: 'session-a', timestamp: 'not-a-date', cwd: intent.directoryPath })}\n`,
    'utf8'
  )

  assert.equal(await store.resolve(intent), undefined)
})

test('quarantines a mismatched pending file without creating a replacement', async () => {
  const { store, storageDirectory } = await createStore()
  const intent = store.intent('session-a')
  const mismatched = `${JSON.stringify({ type: 'session', version: 3, id: 'session-b', timestamp: new Date().toISOString(), cwd: intent.directoryPath })}\n`
  await writeFile(intent.sessionPath, mismatched, 'utf8')

  const outcome = await store.create(intent)

  assert.deepEqual(outcome, { status: 'quarantined' })
  assert.equal(await store.resolve(intent), undefined)
  await assert.rejects(access(intent.sessionPath))
  const quarantined = await readFile(join(storageDirectory, 'session-quarantine', 'session-a.jsonl'), 'utf8')
  assert.equal(quarantined, mismatched)
})

test('ignores and preserves an unowned Pi Session file', async () => {
  const { store, storageDirectory } = await createStore()
  const unownedPath = join(storageDirectory, 'sessions', 'unowned.jsonl')
  await writeFile(unownedPath, '{"external":true}\n', 'utf8')

  await store.create(store.intent('session-a'))

  await access(unownedPath)
  assert.equal(await readFile(unownedPath, 'utf8'), '{"external":true}\n')
})

test('treats a malformed finalized file as unavailable', async () => {
  const { store } = await createStore()
  const intent = store.intent('session-a')
  await writeFile(intent.sessionPath, '{not-json}\n', 'utf8')

  assert.equal(await store.resolve(intent), undefined)
})
