import assert from 'node:assert/strict'
import { access, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, test } from 'node:test'
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
