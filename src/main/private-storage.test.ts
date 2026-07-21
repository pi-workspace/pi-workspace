import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { readPrivateTextFile, writePrivateTextFile } from '@/src/main/private-storage'

test('a private text file is readable and writable only by its owner', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-workspace-private-storage-'))
  const file = join(directory, 'nested', 'settings.json')

  try {
    await writePrivateTextFile(file, '{}\n')

    assert.equal((await stat(file)).mode & 0o777, 0o600)
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})

test('writing private data corrects an existing storage directory permission', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-workspace-private-storage-'))
  const storageDirectory = join(directory, 'storage')

  try {
    await mkdir(storageDirectory, { mode: 0o755 })
    await chmod(storageDirectory, 0o755)
    await writePrivateTextFile(join(storageDirectory, 'settings.json'), '{}\n')

    assert.equal((await stat(storageDirectory)).mode & 0o777, 0o700)
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})

test('writing private data corrects an existing file permission', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-workspace-private-storage-'))
  const file = join(directory, 'settings.json')

  try {
    await writeFile(file, '{}\n', { encoding: 'utf8', mode: 0o644 })
    await chmod(file, 0o644)
    await writePrivateTextFile(file, '{"appearance":"dark"}\n')

    assert.equal((await stat(file)).mode & 0o777, 0o600)
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})

test('reading private data corrects an existing file permission', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-workspace-private-storage-'))
  const file = join(directory, 'settings.json')

  try {
    await writeFile(file, '{}\n', { encoding: 'utf8', mode: 0o644 })
    await chmod(file, 0o644)
    await readPrivateTextFile(file)

    assert.equal((await stat(file)).mode & 0o777, 0o600)
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})

test('reading private data corrects an existing storage directory permission', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-workspace-private-storage-'))
  const storageDirectory = join(directory, 'storage')
  const file = join(storageDirectory, 'projects.json')

  try {
    await mkdir(storageDirectory, { mode: 0o755 })
    await chmod(storageDirectory, 0o755)
    await writeFile(file, '{"projects":[]}\n', 'utf8')
    await readPrivateTextFile(file)

    assert.equal((await stat(storageDirectory)).mode & 0o777, 0o700)
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})
