import { constants } from 'node:fs'
import { access as fsAccess } from 'node:fs/promises'
import { createBashTool, type BashOperations } from '@earendil-works/pi-coding-agent'
import {
  defaultToolExecutionMemoryLimitBytes,
  executeIsolatedCommand,
  type IsolatedCommandResult,
} from './isolated-command'

const maximumTimeoutMilliseconds = 2_147_483_647
const maximumTimeoutSeconds = maximumTimeoutMilliseconds / 1000

export type IsolatedShellOptions = Readonly<{
  commandPrefix?: string
  shellPath?: string
}>

type IsolatedBashToolOptions = Readonly<{
  memoryLimitBytes?: number
  getShellOptions?: () => IsolatedShellOptions
  onExecutionFinished?: (toolCallId: string, outcome: IsolatedCommandResult) => void
}>

export function createIsolatedBashTool(cwd: string, options: IsolatedBashToolOptions = {}) {
  const memoryLimitBytes = options.memoryLimitBytes ?? defaultToolExecutionMemoryLimitBytes
  const template = createBashTool(cwd)

  return {
    ...template,
    async execute(
      toolCallId: string,
      input: Readonly<{ command: string; timeout?: number }>,
      signal?: AbortSignal,
      onUpdate?: Parameters<typeof template.execute>[3]
    ) {
      const shellOptions = options.getShellOptions?.() ?? {}
      let outcome: IsolatedCommandResult | undefined
      const operations: BashOperations = {
        async exec(command, commandCwd, executionOptions) {
          validateTimeout(executionOptions.timeout)
          if (executionOptions.signal?.aborted) throw new Error('aborted')

          if (shellOptions.shellPath) {
            try {
              await fsAccess(shellOptions.shellPath, constants.F_OK)
            } catch {
              throw new Error(`Custom shell path not found: ${shellOptions.shellPath}`)
            }
          }

          try {
            await fsAccess(commandCwd, constants.F_OK)
          } catch {
            throw new Error(`Working directory does not exist: ${commandCwd}\nCannot execute bash commands.`)
          }

          outcome = await executeIsolatedCommand(command, commandCwd, {
            memoryLimitBytes,
            timeoutSeconds: executionOptions.timeout,
            signal: executionOptions.signal,
            env: executionOptions.env,
            shellPath: shellOptions.shellPath,
            onData: executionOptions.onData,
          })

          if (outcome.termination === 'exited' || outcome.termination === 'exit-code') {
            return { exitCode: outcome.exitCode ?? null }
          }
          if (outcome.termination === 'aborted') throw new Error('aborted')
          if (outcome.termination === 'timeout') throw new Error(`timeout:${executionOptions.timeout}`)
          if (outcome.termination === 'memory-limit') {
            throw new Error(
              `Command exceeded its ${formatMemorySize(memoryLimitBytes)} memory limit (peak ${formatMemorySize(outcome.peakMemoryBytes)}).`
            )
          }
          if (outcome.termination === 'signaled') {
            throw new Error(`Command was stopped by signal ${outcome.signal ?? 'unknown'}.`)
          }

          throw new Error('Command could not start because isolated execution is unavailable.')
        },
      }
      const tool = createBashTool(cwd, { commandPrefix: shellOptions.commandPrefix, operations })

      try {
        return await tool.execute(toolCallId, input, signal, onUpdate)
      } finally {
        if (outcome) options.onExecutionFinished?.(toolCallId, outcome)
      }
    },
  }
}

function validateTimeout(timeoutSeconds: number | undefined): void {
  if (timeoutSeconds === undefined) return
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
    throw new Error('Invalid timeout: must be a finite number of seconds')
  }
  if (timeoutSeconds > maximumTimeoutSeconds) {
    throw new Error(`Invalid timeout: maximum is ${maximumTimeoutSeconds} seconds`)
  }
}

function formatMemorySize(bytes: number): string {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
  let value = bytes
  let unitIndex = 0

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  return `${Number.isInteger(value) ? value : value.toFixed(1)} ${units[unitIndex]}`
}
