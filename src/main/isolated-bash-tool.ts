import { createBashTool, type BashOperations } from '@earendil-works/pi-coding-agent'
import {
  defaultToolExecutionMemoryLimitBytes,
  executeIsolatedCommand,
  type IsolatedCommandResult,
} from './isolated-command'

type IsolatedBashToolOptions = Readonly<{
  memoryLimitBytes?: number
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
      let outcome: IsolatedCommandResult | undefined
      const operations: BashOperations = {
        async exec(command, commandCwd, executionOptions) {
          outcome = await executeIsolatedCommand(command, commandCwd, {
            memoryLimitBytes,
            timeoutSeconds: executionOptions.timeout,
            signal: executionOptions.signal,
            env: executionOptions.env,
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
      const tool = createBashTool(cwd, { operations })

      try {
        return await tool.execute(toolCallId, input, signal, onUpdate)
      } finally {
        if (outcome) options.onExecutionFinished?.(toolCallId, outcome)
      }
    },
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
