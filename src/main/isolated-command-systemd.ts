import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { IsolatedCommandOptions, IsolatedCommandResult } from './isolated-command'

const systemdSummaryPrefixes = [
  'Main processes terminated with:',
  'Service runtime:',
  'CPU time consumed:',
  'Memory peak:',
]

export function executeInSystemdUnit(
  command: string,
  cwd: string,
  options: IsolatedCommandOptions
): Promise<IsolatedCommandResult> {
  const unitName = `pi-workspace-tool-${randomUUID()}`
  const loaderScript = [
    "IFS= read -r -d '' command",
    "IFS= read -r -d '' shell",
    'while IFS= read -r -d \'\' assignment; do export "$assignment"; done',
    'exec "$shell" -c "$command"',
  ]
    .join('\n')
    .replaceAll('$', '$$')
  const child = spawn(
    'systemd-run',
    [
      '--user',
      '--pipe',
      '--wait',
      '--collect',
      `--unit=${unitName}`,
      `--working-directory=${cwd}`,
      '--service-type=exec',
      '--property=MemoryAccounting=yes',
      `--property=MemoryMax=${options.memoryLimitBytes}`,
      '--property=MemorySwapMax=0',
      '--property=OOMPolicy=stop',
      '--property=KillMode=control-group',
      '/bin/bash',
      '-c',
      loaderScript,
    ],
    {
      env: { ...process.env, LC_ALL: 'C' },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    }
  )
  const environment = options.env ?? process.env
  const payload = [
    command,
    options.shellPath ?? '/bin/bash',
    ...Object.entries(environment).flatMap(([name, value]) => (value === undefined ? [] : [`${name}=${value}`])),
  ]
    .map((value) => `${value}\0`)
    .join('')
  child.stdin.on('error', () => {})
  child.stdin.end(payload)

  let stderr = ''
  let summaryStarted = false
  let summaryLines: string[] = []
  let systemdResult: string | undefined
  let peakMemoryBytes = 0
  let exitCode: number | undefined
  let signal: string | undefined
  let requestedTermination: 'timeout' | 'aborted' | undefined
  let timeout: ReturnType<typeof setTimeout> | undefined
  let unitStarted = false

  const flushSummaryCandidate = () => {
    if (summaryLines.length > 0) options.onData?.(Buffer.from(`${summaryLines.join('\n')}\n`))

    summaryStarted = false
    summaryLines = []
    systemdResult = undefined
    peakMemoryBytes = 0
    exitCode = undefined
    signal = undefined
  }
  const stopUnit = () => {
    const stopper = spawn('systemctl', ['--user', 'stop', `${unitName}.service`], {
      stdio: 'ignore',
      windowsHide: true,
    })
    stopper.on('error', () => {})
    stopper.unref()
  }
  const stop = (termination: 'timeout' | 'aborted') => {
    if (requestedTermination) return

    requestedTermination = termination
    if (unitStarted) stopUnit()
  }
  const onAbort = () => stop('aborted')

  if (options.timeoutSeconds !== undefined) {
    timeout = setTimeout(() => stop('timeout'), options.timeoutSeconds * 1000)
    timeout.unref?.()
  }
  if (options.signal) {
    if (options.signal.aborted) onAbort()
    else options.signal.addEventListener('abort', onAbort, { once: true })
  }

  child.stdout.on('data', (data: Buffer) => options.onData?.(data))
  child.stderr.on('data', (data: Buffer) => {
    stderr += data.toString('utf8')
    const lines = stderr.split('\n')
    stderr = lines.pop() ?? ''

    for (const line of lines) {
      if (line.startsWith(`Running as unit: ${unitName}.service`)) {
        unitStarted = true
        if (requestedTermination) stopUnit()
        continue
      }

      const summaryOffset = line.lastIndexOf('Finished with result:')
      if (summaryOffset >= 0) {
        if (summaryStarted) flushSummaryCandidate()
        if (summaryOffset > 0) options.onData?.(Buffer.from(line.slice(0, summaryOffset)))

        summaryStarted = true
        summaryLines.push(line.slice(summaryOffset))
        systemdResult = line.slice(summaryOffset + 'Finished with result:'.length).trim()
        continue
      }

      if (summaryStarted && systemdSummaryPrefixes.some((prefix) => line.startsWith(prefix))) {
        summaryLines.push(line)

        const peak = line.match(/^Memory peak:\s+([\d.]+)([KMGT]?)\b/)
        if (peak) peakMemoryBytes = memorySizeInBytes(Number(peak[1]), peak[2] ?? '')

        const termination = line.match(/^Main processes terminated with: code=(\w+), status=(\d+)\/([A-Z0-9]+)$/)
        if (termination?.[1] === 'exited') exitCode = Number(termination[2])
        if (termination?.[1] === 'killed') signal = termination[3]
        continue
      }

      if (summaryStarted) flushSummaryCandidate()
      options.onData?.(Buffer.from(`${line}\n`))
    }
  })

  return new Promise((resolve) => {
    let settled = false
    const finish = (result: IsolatedCommandResult) => {
      if (settled) return

      settled = true
      if (timeout) clearTimeout(timeout)
      if (options.signal) options.signal.removeEventListener('abort', onAbort)
      resolve(result)
    }

    child.once('error', () => finish({ termination: 'isolation-failure', peakMemoryBytes: 0 }))
    child.once('close', (systemdExitCode) => {
      if (stderr) {
        if (summaryStarted) flushSummaryCandidate()
        options.onData?.(Buffer.from(stderr))
      }

      if (requestedTermination) {
        finish({ termination: requestedTermination, peakMemoryBytes, signal })
      } else if (systemdResult === 'oom-kill') {
        finish({ termination: 'memory-limit', peakMemoryBytes, signal })
      } else if (systemdResult === 'success' && (exitCode ?? systemdExitCode) === 0) {
        finish({ termination: 'exited', peakMemoryBytes, exitCode: 0 })
      } else if (exitCode !== undefined) {
        finish({ termination: 'exit-code', peakMemoryBytes, exitCode })
      } else if (signal) {
        finish({ termination: 'signaled', peakMemoryBytes, signal })
      } else {
        finish({ termination: 'isolation-failure', peakMemoryBytes })
      }
    })
  })
}

function memorySizeInBytes(value: number, unit: string): number {
  const exponent = ['', 'K', 'M', 'G', 'T'].indexOf(unit)

  return Math.round(value * 1024 ** Math.max(0, exponent))
}
