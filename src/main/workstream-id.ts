import { randomBytes } from 'node:crypto'

export function createWorkstreamId(): string {
  const timestamp = Date.now().toString(16).padStart(12, '0')
  const entropy = randomBytes(10).toString('hex')
  const variant = ((Number.parseInt(entropy[3]!, 16) & 0x3) | 0x8).toString(16)

  return `${timestamp.slice(0, 8)}-${timestamp.slice(8)}-7${entropy.slice(0, 3)}-${variant}${entropy.slice(4, 7)}-${entropy.slice(7, 19)}`
}

export function worktreeName(workstreamId: string): string {
  return workstreamId.slice(-12)
}
