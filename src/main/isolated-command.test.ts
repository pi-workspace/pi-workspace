import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createIsolatedBashTool } from './isolated-bash-tool'
import { defaultToolExecutionMemoryLimitBytes, executeIsolatedCommand } from './isolated-command'

const mebibyte = 1024 * 1024
const memoryExhaustionCommand = `${JSON.stringify(process.execPath)} -e 'const value = new Uint8Array(256 * 1024 * 1024); value.fill(1); setTimeout(() => console.log(value.length), 10_000)'`

function firstTextContent(
  result: Awaited<ReturnType<ReturnType<typeof createIsolatedBashTool>['execute']>>
): string | undefined {
  const content = result.content[0]

  return content?.type === 'text' ? content.text : undefined
}

async function waitForProcessExit(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      process.kill(pid, 0)
    } catch {
      return
    }

    await new Promise((resolve) => setTimeout(resolve, 25))
  }

  assert.fail(`Process ${pid} remained alive.`)
}

async function canUseUserSystemd(): Promise<boolean> {
  if (process.platform !== 'linux') return false

  const result = await executeIsolatedCommand('true', process.cwd(), {
    memoryLimitBytes: 64 * mebibyte,
  }).catch(() => undefined)

  return result?.termination === 'exited'
}

const userSystemdAvailable = await canUseUserSystemd()

test('Agent bash commands default to a 2 GiB memory limit', () => {
  assert.equal(defaultToolExecutionMemoryLimitBytes, 2 * 1024 * mebibyte)
})

test('the bash tool retains Pi timeout validation', async () => {
  const tool = createIsolatedBashTool(process.cwd())

  await assert.rejects(
    () => tool.execute('tool-1', { command: 'true', timeout: 0 }),
    /Invalid timeout: must be a finite number of seconds/
  )
})

test('the bash tool retains Pi working-directory errors', async () => {
  const missingDirectory = join(tmpdir(), `pi-workspace-missing-${randomUUID()}`)
  const tool = createIsolatedBashTool(missingDirectory)

  await assert.rejects(
    () => tool.execute('tool-1', { command: 'true' }),
    new RegExp(`Working directory does not exist: ${missingDirectory}`)
  )
})

test('the bash tool retains Pi shell command prefixes', { skip: !userSystemdAvailable }, async () => {
  const tool = createIsolatedBashTool(process.cwd(), {
    getShellOptions: () => ({ commandPrefix: 'export PI_WORKSPACE_PREFIX=retained' }),
  })

  const result = await tool.execute('tool-1', { command: 'printf %s "$PI_WORKSPACE_PREFIX"' })

  assert.equal(firstTextContent(result), 'retained')
})

test('the bash tool retains Pi configured shell paths', { skip: !userSystemdAvailable }, async () => {
  const tool = createIsolatedBashTool(process.cwd(), {
    getShellOptions: () => ({ shellPath: '/bin/sh' }),
  })

  const result = await tool.execute('tool-1', { command: 'printf %s "$0"' })

  assert.equal(firstTextContent(result), '/bin/sh')
})

test(
  'a command exceeding its memory limit is stopped without terminating the caller',
  { skip: !userSystemdAvailable },
  async () => {
    const result = await executeIsolatedCommand(memoryExhaustionCommand, process.cwd(), {
      memoryLimitBytes: 96 * mebibyte,
    })

    assert.equal(result.termination, 'memory-limit')
    assert.ok(result.peakMemoryBytes > 0)
  }
)

test('a successful command preserves stderr without a trailing newline', { skip: !userSystemdAvailable }, async () => {
  let output = ''

  const result = await executeIsolatedCommand('printf error-output >&2', process.cwd(), {
    memoryLimitBytes: 64 * mebibyte,
    onData(data) {
      output += data.toString('utf8')
    },
  })

  assert.equal(result.termination, 'exited')
  assert.equal(output, 'error-output')
})

test('a successful command preserves stderr resembling systemd metadata', { skip: !userSystemdAvailable }, async () => {
  let output = ''

  const result = await executeIsolatedCommand("printf 'Finished with result: success\\n' >&2", process.cwd(), {
    memoryLimitBytes: 64 * mebibyte,
    onData(data) {
      output += data.toString('utf8')
    },
  })

  assert.equal(result.termination, 'exited')
  assert.equal(output, 'Finished with result: success\n')
})

test('process-group isolation stops a command exceeding its memory limit', async () => {
  const result = await executeIsolatedCommand(memoryExhaustionCommand, process.cwd(), {
    memoryLimitBytes: 96 * mebibyte,
    platform: 'darwin',
  })

  assert.equal(result.termination, 'memory-limit')
  assert.ok(result.peakMemoryBytes > 96 * mebibyte)
})

test('process-group memory accounting includes a descendant in another process group', async () => {
  const allocatorProgram = `const value = new Uint8Array(256 * 1024 * 1024); value.fill(1); setTimeout(() => {}, 10_000)`
  const descendantProgram = `const { spawn } = require('node:child_process'); const child = spawn(process.execPath, ['-e', ${JSON.stringify(allocatorProgram)}], { detached: true, stdio: 'ignore' }); console.log(child.pid); child.unref(); setTimeout(() => {}, 10_000)`
  const command = `${JSON.stringify(process.execPath)} -e ${JSON.stringify(descendantProgram)}`
  let output = ''
  let descendantPid = 0

  try {
    const result = await executeIsolatedCommand(command, process.cwd(), {
      memoryLimitBytes: 96 * mebibyte,
      platform: 'darwin',
      onData(data) {
        output += data.toString('utf8')
      },
    })
    descendantPid = Number(output.trim())

    assert.equal(result.termination, 'memory-limit')
    assert.ok(Number.isInteger(descendantPid) && descendantPid > 1, JSON.stringify(output))
  } finally {
    if (descendantPid > 1) {
      try {
        process.kill(descendantPid, 'SIGKILL')
      } catch {
        // The isolated command already stopped the descendant.
      }
    }
  }
})

test('the bash tool reports memory exhaustion as a useful failure', { skip: !userSystemdAvailable }, async () => {
  const tool = createIsolatedBashTool(process.cwd(), { memoryLimitBytes: 96 * mebibyte })

  await assert.rejects(
    () => tool.execute('tool-1', { command: memoryExhaustionCommand }),
    /exceeded its 96 MiB memory limit/
  )
})

test('the bash tool retains the command termination outcome', { skip: !userSystemdAvailable }, async () => {
  let observedTermination: string | undefined
  const tool = createIsolatedBashTool(process.cwd(), {
    memoryLimitBytes: 96 * mebibyte,
    onExecutionFinished(_toolCallId, outcome) {
      observedTermination = outcome.termination
    },
  })

  await tool.execute('tool-1', { command: memoryExhaustionCommand }).catch(() => undefined)

  assert.equal(observedTermination, 'memory-limit')
})

test('background descendants are stopped when their command completes', { skip: !userSystemdAvailable }, async () => {
  let output = ''

  const result = await executeIsolatedCommand('nohup sleep 60 >/dev/null 2>&1 & echo $!', process.cwd(), {
    memoryLimitBytes: 64 * mebibyte,
    onData(data) {
      output += data.toString('utf8')
    },
  })
  const descendantPid = Number(output.trim())

  assert.equal(result.termination, 'exited')
  assert.ok(Number.isInteger(descendantPid) && descendantPid > 1, JSON.stringify(output))
  await waitForProcessExit(descendantPid)
})

test('timing out a command stops all of its descendants', { skip: !userSystemdAvailable }, async () => {
  let output = ''

  const result = await executeIsolatedCommand('nohup sleep 60 >/dev/null 2>&1 & echo $!; wait', process.cwd(), {
    memoryLimitBytes: 64 * mebibyte,
    timeoutSeconds: 1,
    onData(data) {
      output += data.toString('utf8')
    },
  })
  const descendantPid = Number(output.trim())

  assert.equal(result.termination, 'timeout')
  assert.ok(Number.isInteger(descendantPid) && descendantPid > 1, JSON.stringify(output))
  await waitForProcessExit(descendantPid)
})

test('process-group isolation also stops background descendants when their command completes', async () => {
  let output = ''

  const result = await executeIsolatedCommand('nohup sleep 60 >/dev/null 2>&1 & echo $!', process.cwd(), {
    memoryLimitBytes: 64 * mebibyte,
    platform: 'darwin',
    onData(data) {
      output += data.toString('utf8')
    },
  })
  const descendantPid = Number(output.trim())

  assert.equal(result.termination, 'exited')
  assert.ok(Number.isInteger(descendantPid) && descendantPid > 1, JSON.stringify(output))
  await waitForProcessExit(descendantPid)
})

test('process-group isolation stops a descendant that creates another process group', async () => {
  const descendantProgram = `const { spawn } = require('node:child_process'); const child = spawn('sleep', ['60'], { detached: true, stdio: 'ignore' }); console.log(child.pid); child.unref()`
  const command = `${JSON.stringify(process.execPath)} -e ${JSON.stringify(descendantProgram)}`
  let output = ''
  let descendantPid = 0

  try {
    const result = await executeIsolatedCommand(command, process.cwd(), {
      memoryLimitBytes: 64 * mebibyte,
      platform: 'darwin',
      onData(data) {
        output += data.toString('utf8')
      },
    })
    descendantPid = Number(output.trim())

    assert.equal(result.termination, 'exited')
    assert.ok(Number.isInteger(descendantPid) && descendantPid > 1, JSON.stringify(output))
    await waitForProcessExit(descendantPid)
  } finally {
    if (descendantPid > 1) {
      try {
        process.kill(descendantPid, 'SIGKILL')
      } catch {
        // The isolated command already stopped the descendant.
      }
    }
  }
})
