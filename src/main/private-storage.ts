import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'

export async function ensurePrivateDirectory(path: string): Promise<void> {
  await mkdir(path, { mode: 0o700, recursive: true })
  await chmod(path, 0o700)
}

export async function ensurePrivateFile(path: string): Promise<void> {
  await ensurePrivateDirectory(dirname(path))
  await chmod(path, 0o600)
}

export async function readPrivateTextFile(path: string): Promise<string> {
  await ensurePrivateDirectory(dirname(path))
  const contents = await readFile(path, 'utf8')
  await ensurePrivateFile(path)

  return contents
}

export async function writePrivateTextFile(path: string, contents: string): Promise<void> {
  await ensurePrivateDirectory(dirname(path))

  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`

  try {
    await writeFile(temporaryPath, contents, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    await rename(temporaryPath, path)
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => {})
    throw error
  }
}
