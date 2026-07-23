import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { IsolatedCommandOptions, IsolatedCommandResult } from './isolated-command'

type IsolatedProcess = Readonly<{
  pid: number
  processGroupId: number
  residentMemoryBytes: number
}>

export function executeInProcessGroup(
  command: string,
  cwd: string,
  options: IsolatedCommandOptions
): Promise<IsolatedCommandResult> {
  const markerName = `PI_WORKSPACE_TOOL_${randomUUID().replaceAll('-', '')}`
  const markerValue = '1'
  const executionMarker = `${markerName}=${markerValue}`
  const child = spawn(options.shellPath ?? '/bin/bash', ['-c', command], {
    cwd,
    detached: true,
    env: { [markerName]: markerValue, ...(options.env ?? process.env) },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  let peakMemoryBytes = 0
  let requestedTermination: 'memory-limit' | 'timeout' | 'aborted' | 'isolation-failure' | undefined
  let exited = false
  let timeout: ReturnType<typeof setTimeout> | undefined
  let sampleInProgress = false
  let observedProcesses: readonly IsolatedProcess[] = []

  const killGroup = () => {
    killIsolatedProcesses(observedProcesses, child.pid)
  }
  const stop = (termination: 'memory-limit' | 'timeout' | 'aborted' | 'isolation-failure') => {
    if (requestedTermination) return

    requestedTermination = termination
    killGroup()
  }
  const onAbort = () => stop('aborted')
  const sampleMemory = async () => {
    if (!child.pid || exited || sampleInProgress) return

    sampleInProgress = true

    try {
      const processes = await isolatedProcessSnapshot(executionMarker)
      if (processes === undefined) {
        stop('isolation-failure')
        return
      }

      observedProcesses = processes
      const currentMemoryBytes = processes.reduce((total, process) => total + process.residentMemoryBytes, 0)
      peakMemoryBytes = Math.max(peakMemoryBytes, currentMemoryBytes)

      if (exited) {
        killGroup()
        return
      }

      if (currentMemoryBytes > options.memoryLimitBytes) stop('memory-limit')
    } finally {
      sampleInProgress = false
    }
  }

  if (options.timeoutSeconds !== undefined) {
    timeout = setTimeout(() => stop('timeout'), options.timeoutSeconds * 1000)
    timeout.unref?.()
  }
  if (options.signal) {
    if (options.signal.aborted) onAbort()
    else options.signal.addEventListener('abort', onAbort, { once: true })
  }

  child.stdout.on('data', (data: Buffer) => options.onData?.(data))
  child.stderr.on('data', (data: Buffer) => options.onData?.(data))
  const memoryPoll = setInterval(() => void sampleMemory(), 25)
  memoryPoll.unref?.()
  void sampleMemory()

  return new Promise((resolve) => {
    let settled = false
    const finish = (result: IsolatedCommandResult) => {
      if (settled) return

      settled = true
      exited = true
      if (timeout) clearTimeout(timeout)
      clearInterval(memoryPoll)
      if (options.signal) options.signal.removeEventListener('abort', onAbort)
      resolve(result)
    }

    child.once('error', () => finish({ termination: 'isolation-failure', peakMemoryBytes }))
    child.once('exit', () => {
      exited = true
      killGroup()
    })
    child.once('close', async (exitCode, childSignal) => {
      const finalProcesses = await isolatedProcessSnapshot(executionMarker)
      if (finalProcesses === undefined && !requestedTermination) {
        finish({ termination: 'isolation-failure', peakMemoryBytes })
        return
      }
      if (finalProcesses) {
        observedProcesses = finalProcesses
        const finalMemoryBytes = finalProcesses.reduce((total, process) => total + process.residentMemoryBytes, 0)
        peakMemoryBytes = Math.max(peakMemoryBytes, finalMemoryBytes)
        if (finalMemoryBytes > options.memoryLimitBytes) requestedTermination ??= 'memory-limit'
      }
      killGroup()

      if (requestedTermination) {
        finish({ termination: requestedTermination, peakMemoryBytes, signal: childSignal ?? undefined })
      } else if (exitCode === 0) {
        finish({ termination: 'exited', peakMemoryBytes, exitCode })
      } else if (exitCode !== null) {
        finish({ termination: 'exit-code', peakMemoryBytes, exitCode })
      } else {
        finish({ termination: 'signaled', peakMemoryBytes, signal: childSignal ?? undefined })
      }
    })
  })
}

function isolatedProcessSnapshot(executionMarker: string): Promise<readonly IsolatedProcess[] | undefined> {
  const markerMidpoint = Math.floor(executionMarker.length / 2)
  const markerStart = executionMarker.slice(0, markerMidpoint)
  const markerEnd = executionMarker.slice(markerMidpoint)
  const processList = spawn('/bin/ps', ['axeww', '-o', 'pid=,pgid=,rss=,command='], {
    stdio: ['ignore', 'pipe', 'ignore'],
    windowsHide: true,
  })
  const filter = spawn(
    '/usr/bin/awk',
    [
      '-v',
      `markerStart=${markerStart}`,
      '-v',
      `markerEnd=${markerEnd}`,
      'index($0, markerStart markerEnd) { print $1, $2, $3 }',
    ],
    { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true }
  )
  let output = ''
  let processListFailed = false

  processList.stdout.pipe(filter.stdin)
  filter.stdin.on('error', () => {})
  processList.once('error', () => {
    processListFailed = true
    filter.stdin.end()
  })
  processList.once('close', (exitCode) => {
    if (exitCode !== 0) processListFailed = true
  })
  filter.stdout.on('data', (data: Buffer) => {
    output += data.toString('utf8')
  })

  return new Promise((resolve) => {
    let settled = false
    const finish = (processes: readonly IsolatedProcess[] | undefined) => {
      if (settled) return

      settled = true
      resolve(processes)
    }

    filter.once('error', () => finish(undefined))
    filter.once('close', (exitCode) => {
      if (exitCode !== 0 || processListFailed) {
        finish(undefined)
        return
      }

      const processes = output
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const [pid, processGroupId, residentKibibytes] = line.trim().split(/\s+/).map(Number)

          return {
            pid: pid ?? 0,
            processGroupId: processGroupId ?? 0,
            residentMemoryBytes: (residentKibibytes ?? 0) * 1024,
          }
        })
        .filter((process) => process.pid > 1 && process.processGroupId > 1)

      finish(processes)
    })
  })
}

function killIsolatedProcesses(processes: readonly IsolatedProcess[], rootPid: number | undefined): void {
  const processGroupIds = new Set(processes.map((process) => process.processGroupId))
  if (rootPid) processGroupIds.add(rootPid)

  for (const processGroupId of processGroupIds) {
    try {
      process.kill(-processGroupId, 'SIGKILL')
    } catch {
      // The process group has already stopped.
    }
  }

  for (const isolatedProcess of processes) {
    try {
      process.kill(isolatedProcess.pid, 'SIGKILL')
    } catch {
      // The process has already stopped.
    }
  }
}
