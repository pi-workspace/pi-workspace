import type { ToolExecutionCommandOutcome } from '@/src/session-timeline'
import { executeInProcessGroup } from './isolated-command-process-group'
import { executeInSystemdUnit } from './isolated-command-systemd'

export type IsolatedCommandResult = ToolExecutionCommandOutcome

export type IsolatedCommandOptions = Readonly<{
  memoryLimitBytes: number
  timeoutSeconds?: number
  signal?: AbortSignal
  env?: NodeJS.ProcessEnv
  onData?: (data: Buffer) => void
  platform?: NodeJS.Platform
}>

export const defaultToolExecutionMemoryLimitBytes = 2 * 1024 * 1024 * 1024

export function executeIsolatedCommand(
  command: string,
  cwd: string,
  options: IsolatedCommandOptions
): Promise<IsolatedCommandResult> {
  const platform = options.platform ?? process.platform

  if (platform === 'linux') return executeInSystemdUnit(command, cwd, options)
  if (platform === 'darwin') return executeInProcessGroup(command, cwd, options)

  return Promise.resolve({ termination: 'isolation-failure', peakMemoryBytes: 0 })
}
