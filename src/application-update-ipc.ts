export const applicationUpdateIpcChannels = {
  changed: 'application-update:changed',
  getSnapshot: 'application-update:get-snapshot',
  command: 'application-update:command',
} as const

export type ApplicationUpdateCommand = 'check' | 'download' | 'restart' | 'open-release'

const applicationUpdateCommands = new Set<ApplicationUpdateCommand>(['check', 'download', 'restart', 'open-release'])

export function parseApplicationUpdateCommand(value: unknown): ApplicationUpdateCommand | undefined {
  return typeof value === 'string' && applicationUpdateCommands.has(value as ApplicationUpdateCommand)
    ? (value as ApplicationUpdateCommand)
    : undefined
}
