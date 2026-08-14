import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

interface RuntimeDocument {
  pid: number
  startedAt: string
  stdout: string
  stderr: string
}

export interface StartOptions { daemon?: boolean }

/** Start the dedicated Discord profile in the foreground or as a managed daemon. */
export async function start(options: StartOptions = {}): Promise<void> {
  if (options.daemon === true) {
    startDaemon()
    return
  }
  await new Promise<void>((resolveRun, reject) => {
    const child = spawn('dsh', ['--profile', 'discord'], {
      stdio: 'inherit', env: process.env, shell: process.platform === 'win32',
    })
    child.once('error', () => reject(new Error('无法启动 dsh；请先安装 DeepSeek Harness。')))
    child.once('exit', code => code === 0 ? resolveRun() : reject(new Error(`Discord profile 已退出（${String(code ?? 1)}）。`)))
  })
}

/** Stop the daemon previously created by `start --daemon`. */
export function stopDaemon(): void {
  const runtime = readRuntime()
  if (runtime === undefined) {
    process.stdout.write('dsh-discord 后台进程未运行。\n')
    return
  }
  if (!isRunning(runtime.pid)) {
    removeRuntime()
    process.stdout.write('已清理过期的 dsh-discord 运行状态。\n')
    return
  }
  if (process.platform === 'win32') {
    const result = spawnSync('taskkill.exe', ['/PID', String(runtime.pid), '/T', '/F'], {
      stdio: 'ignore', windowsHide: true,
    })
    if (result.status !== 0) throw new Error('无法停止 dsh-discord 后台进程。')
  } else {
    process.kill(-runtime.pid, 'SIGTERM')
  }
  removeRuntime()
  process.stdout.write('dsh-discord 后台进程已停止。\n')
}

/** Print daemon status and log locations without reading log contents. */
export function daemonStatus(): void {
  const runtime = readRuntime()
  if (runtime === undefined || !isRunning(runtime.pid)) {
    if (runtime !== undefined) removeRuntime()
    process.stdout.write('状态：未运行\n')
    return
  }
  process.stdout.write(`状态：运行中\nPID：${String(runtime.pid)}\n启动：${runtime.startedAt}\nstdout：${runtime.stdout}\nstderr：${runtime.stderr}\n`)
}

function startDaemon(): void {
  const existing = readRuntime()
  if (existing !== undefined && isRunning(existing.pid)) throw new Error(`dsh-discord 已在运行（PID ${String(existing.pid)}）。`)
  if (existing !== undefined) removeRuntime()
  const directory = runtimeDirectory()
  const logs = join(directory, 'logs')
  mkdirSync(logs, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const stdout = join(logs, `${stamp}.stdout.log`)
  const stderr = join(logs, `${stamp}.stderr.log`)
  const outFd = openSync(stdout, 'a', 0o600)
  const errFd = openSync(stderr, 'a', 0o600)
  let child
  try {
    child = spawn('dsh', ['--profile', 'discord'], {
      cwd: process.cwd(),
      detached: true,
      env: process.env,
      shell: process.platform === 'win32',
      stdio: ['ignore', outFd, errFd],
      windowsHide: true,
    })
  } finally {
    closeSync(outFd)
    closeSync(errFd)
  }
  if (child.pid === undefined) throw new Error('无法取得 dsh-discord 后台进程 PID。')
  child.once('error', () => removeRuntime())
  child.unref()
  const runtime: RuntimeDocument = { pid: child.pid, startedAt: new Date().toISOString(), stdout, stderr }
  writeFileSync(runtimeFilename(), JSON.stringify(runtime, undefined, 2) + '\n', { encoding: 'utf8', mode: 0o600 })
  process.stdout.write(`dsh-discord 已在后台启动（PID ${String(child.pid)}）。\n`)
}

function readRuntime(): RuntimeDocument | undefined {
  const filename = runtimeFilename()
  if (!existsSync(filename)) return undefined
  try {
    const value: unknown = JSON.parse(readFileSync(filename, 'utf8'))
    if (typeof value !== 'object' || value === null) return undefined
    const item = value as Record<string, unknown>
    if (!Number.isSafeInteger(item.pid) || (item.pid as number) <= 0
      || typeof item.startedAt !== 'string' || typeof item.stdout !== 'string' || typeof item.stderr !== 'string') return undefined
    return item as unknown as RuntimeDocument
  } catch {
    return undefined
  }
}

function isRunning(pid: number): boolean {
  try { process.kill(pid, 0); return true } catch { return false }
}

function removeRuntime(): void {
  rmSync(runtimeFilename(), { force: true })
}

function runtimeFilename(): string {
  const directory = runtimeDirectory()
  mkdirSync(directory, { recursive: true })
  return join(directory, 'runtime.json')
}

function runtimeDirectory(): string {
  const home = resolve(process.env.DSH_HOME?.trim() || join(homedir(), '.dsh'))
  return join(home, 'dsh-discord')
}
