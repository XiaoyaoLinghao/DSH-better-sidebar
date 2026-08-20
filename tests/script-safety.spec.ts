import { createHash, randomBytes } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const helper = resolve(process.cwd(), 'scripts/safe-temp.mjs')

function invoke(...args: string[]) {
  return spawnSync(process.execPath, [helper, ...args], { encoding: 'utf8' })
}

function invokeAsync(args: string[], env?: NodeJS.ProcessEnv) {
  return spawn(process.execPath, [helper, ...args], { env: { ...process.env, NODE_ENV: 'test', ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
}

function createSandbox() {
  const sandbox = mkdtempSync(join(tmpdir(), 'dsh-script-safety.'))
  const root = join(sandbox, 'repo')
  const base = join(sandbox, 'temp')
  mkdirSync(root)
  mkdirSync(base)
  return { sandbox, root, base }
}

function createOwned(base: string, root: string, prefix = 'dsh-safety.') {
  const result = invoke('create', base, root, prefix)
  expect(result.status, result.stderr).toBe(0)
  return JSON.parse(result.stdout) as { scratch: string; token: string }
}

describe('verification script scratch safety', () => {
  it('requires canonical non-overlapping roots and rejects aliases', () => {
    const { sandbox, root, base } = createSandbox()
    try {
      expect(invoke('create', root, root, 'dsh-safety.').status).not.toBe(0)
      mkdirSync(join(root, 'nested'))
      expect(invoke('create', join(root, 'nested'), root, 'dsh-safety.').status).not.toBe(0)
      expect(invoke('create', base, sandbox, 'dsh-safety.').status).not.toBe(0)
      const alias = join(sandbox, 'root-alias')
      symlinkSync(root, alias, 'junction')
      expect(invoke('create', alias, root, 'dsh-safety.').status).not.toBe(0)
    } finally {
      rmSync(sandbox, { recursive: true, force: true })
    }
  })

  it('uses an unpredictable ownership token and permits idempotent cleanup', () => {
    const { sandbox, root, base } = createSandbox()
    try {
      const owned = createOwned(base, root)
      const marker = JSON.parse(readFileSync(join(owned.scratch, '.dsh-verification-owner.json'), 'utf8')) as Record<string, string | number>
      expect(marker.version).toBe(1)
      expect(marker.token).toBe(owned.token)
      expect(typeof owned.token).toBe('string')
      const removed = invoke('remove', owned.scratch, base, root, 'dsh-safety.', owned.token)
      expect(removed.status).toBe(0)
      const quarantine = JSON.parse(removed.stdout).quarantine as string
      expect(existsSync(quarantine)).toBe(true)
      expect(existsSync(join(quarantine, '.dsh-verification-owner.json'))).toBe(true)
      expect(existsSync(join(quarantine, `.dsh-verification-receipt-${createHash('sha256').update(owned.token).digest('hex')}.json`))).toBe(true)
      expect(invoke('remove', owned.scratch, base, root, 'dsh-safety.', owned.token).status).toBe(0)
      expect(existsSync(owned.scratch)).toBe(false)
      const recreated = createOwned(base, root)
      expect(invoke('remove', recreated.scratch, base, root, 'dsh-safety.', recreated.token).status).toBe(0)
      mkdirSync(recreated.scratch)
      expect(invoke('remove', recreated.scratch, base, root, 'dsh-safety.', recreated.token).status).not.toBe(0)
    } finally {
      rmSync(sandbox, { recursive: true, force: true })
    }
  })

  it('rejects copied markers, forged tokens, and renamed or junction-swapped scratch paths', () => {
    const { sandbox, root, base } = createSandbox()
    try {
      const owned = createOwned(base, root)
      const clone = join(base, 'dsh-safety-clone')
      cpSync(owned.scratch, clone, { recursive: true })
      expect(invoke('remove', clone, base, root, 'dsh-safety.', owned.token).status).not.toBe(0)
      expect(existsSync(clone)).toBe(true)
      expect(invoke('remove', owned.scratch, base, root, 'dsh-safety.', '0'.repeat(64)).status).not.toBe(0)

      const moved = join(base, 'moved-away')
      renameSync(owned.scratch, moved)
      symlinkSync(moved, owned.scratch, 'junction')
      expect(invoke('remove', owned.scratch, base, root, 'dsh-safety.', owned.token).status).not.toBe(0)
      rmSync(owned.scratch, { force: true })
      rmSync(moved, { recursive: true, force: true })
      rmSync(clone, { recursive: true, force: true })
    } finally {
      rmSync(sandbox, { recursive: true, force: true })
    }
  })

  it('rejects empty and traversal arguments and restricts junction links to owned scratch', () => {
    const { sandbox, root, base } = createSandbox()
    try {
      expect(invoke('create', base, root, '../escape').status).not.toBe(0)
      expect(invoke('remove', '', base, root, 'dsh-safety.', '').status).not.toBe(0)
      const owned = createOwned(base, root)
      const outside = join(sandbox, 'outside-link')
      expect(invoke('link', root, outside, owned.scratch, base, root, 'dsh-safety.', owned.token).status).not.toBe(0)
      const inside = join(owned.scratch, 'node_modules', 'dsh-better-sidebar')
      mkdirSync(join(owned.scratch, 'node_modules'))
      expect(invoke('link', root, inside, owned.scratch, base, root, 'dsh-safety.', owned.token).status).toBe(0)
      expect(lstatSync(inside).isSymbolicLink()).toBe(true)
      invoke('remove', owned.scratch, base, root, 'dsh-safety.', owned.token)
    } finally {
      rmSync(sandbox, { recursive: true, force: true })
    }
  })

  it('launches the real child directly and terminates its process tree', async () => {
    const { sandbox } = createSandbox()
    const pidFile = join(sandbox, 'child.pid')
    const logFile = join(sandbox, 'child.log')
    try {
      const launcher = spawn(process.execPath, [helper, 'launch', pidFile, logFile, process.execPath, '-e', 'setTimeout(() => {}, 10000)'], { stdio: 'ignore' })
      for (let attempt = 0; attempt < 40 && !existsSync(pidFile); attempt++) await new Promise((resolve) => setTimeout(resolve, 25))
      expect(existsSync(pidFile)).toBe(true)
      const pid = readFileSync(pidFile, 'utf8').trim()
      expect(invoke('terminate', pid).status).toBe(0)
      await new Promise<void>((resolve) => launcher.once('exit', () => resolve()))
      expect(existsSync(pidFile)).toBe(false)
    } finally {
      rmSync(sandbox, { recursive: true, force: true })
    }
  })

  it('force-kills a process group when parent and descendant ignore SIGTERM', async () => {
    const { sandbox } = createSandbox()
    const pidFile = join(sandbox, 'parent.pid')
    const childPidFile = join(sandbox, 'child.pid')
    const logFile = join(sandbox, 'tree.log')
    const script = 'const fs=require("node:fs");const {spawn}=require("node:child_process");process.on("SIGTERM",()=>{});const c=spawn(process.execPath,["-e","process.on(\\"SIGTERM\\",()=>{});setTimeout(()=>{},60000)"]);fs.writeFileSync(process.argv[1],String(c.pid));setTimeout(()=>{},60000)'
    try {
      const launcher = invokeAsync(['launch', pidFile, logFile, process.execPath, '-e', script, childPidFile])
      for (let attempt = 0; attempt < 80 && (!existsSync(pidFile) || !existsSync(childPidFile)); attempt++) await new Promise((resolve) => setTimeout(resolve, 25))
      expect(existsSync(pidFile)).toBe(true)
      expect(existsSync(childPidFile)).toBe(true)
      const parentPid = readFileSync(pidFile, 'utf8').trim()
      const childPid = readFileSync(childPidFile, 'utf8').trim()
      expect(invoke('terminate', parentPid).status).toBe(0)
      await Promise.race([
        new Promise<void>((resolve) => launcher.once('exit', () => resolve())),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('launcher did not terminate')), 5000)),
      ])
      const alive = (pid: string) => spawnSync(process.execPath, ['-e', `try { process.kill(${pid}, 0); process.exit(0) } catch { process.exit(1) }`]).status === 0
      expect(alive(parentPid)).toBe(false)
      expect(alive(childPid)).toBe(false)
    } finally {
      rmSync(sandbox, { recursive: true, force: true })
    }
  })

  it('does not delete a swapped path when validation races with an attacker', async () => {
    const { sandbox, root, base } = createSandbox()
    const pause = join(sandbox, 'pause')
    try {
      const owned = createOwned(base, root)
      const moved = join(base, 'moved-original')
      mkdirSync(pause)
      const pauseToken = randomBytes(32).toString('hex')
      const remover = invokeAsync(['remove-test', owned.scratch, base, root, 'dsh-safety.', owned.token, pause, pauseToken])
      for (let attempt = 0; attempt < 40 && !existsSync(join(pause, `ready.validated.${pauseToken}`)); attempt++) await new Promise((resolve) => setTimeout(resolve, 25))
      expect(existsSync(join(pause, `ready.validated.${pauseToken}`))).toBe(true)
      renameSync(owned.scratch, moved)
      mkdirSync(owned.scratch)
      writeFileSync(join(pause, `go.validated.${pauseToken}`), 'go')
      await new Promise<void>((resolve) => remover.once('exit', () => resolve()))
      expect(remover.exitCode).not.toBe(0)
      expect(existsSync(owned.scratch)).toBe(true)
      expect(existsSync(moved)).toBe(true)
    } finally {
      rmSync(sandbox, { recursive: true, force: true })
    }
  })

  it('keeps both paths recoverable when a watcher swaps the boundary after quarantine validation', async () => {
    const { sandbox, root, base } = createSandbox()
    const pause = join(sandbox, 'pause-boundary')
    try {
      const owned = createOwned(base, root)
      const pauseToken = randomBytes(32).toString('hex')
      const remover = invokeAsync(['remove-test', owned.scratch, base, root, 'dsh-safety.', owned.token, pause, pauseToken])
      let stdout = ''
      remover.stdout?.on('data', (chunk) => { stdout += String(chunk) })
      for (let attempt = 0; attempt < 80 && !existsSync(join(pause, `ready.validated.${pauseToken}`)); attempt++) await new Promise((resolve) => setTimeout(resolve, 25))
      expect(existsSync(join(pause, `ready.validated.${pauseToken}`))).toBe(true)
      writeFileSync(join(pause, `go.validated.${pauseToken}`), 'go')
      for (let attempt = 0; attempt < 80 && !existsSync(join(pause, `ready.boundary.${pauseToken}`)); attempt++) await new Promise((resolve) => setTimeout(resolve, 25))
      expect(existsSync(join(pause, `ready.boundary.${pauseToken}`))).toBe(true)
      mkdirSync(owned.scratch)
      writeFileSync(join(pause, `go.boundary.${pauseToken}`), 'go')
      await new Promise<void>((resolve) => remover.once('exit', () => resolve()))
      expect(remover.exitCode).toBe(0)
      const quarantine = JSON.parse(stdout).quarantine as string
      expect(existsSync(owned.scratch)).toBe(true)
      expect(existsSync(quarantine)).toBe(true)
    } finally {
      rmSync(sandbox, { recursive: true, force: true })
    }
  })

  it('keeps the mount script on the fresh-pack and isolated-launch contract', () => {
    const script = readFileSync(resolve(process.cwd(), 'scripts/e2e-mount.sh'), 'utf8')
    expect(script).toContain('pnpm pack --pack-destination "$SCRATCH"')
    expect(script).toContain('node "$SAFE_TEMP" launch')
    expect(script).toContain('DSH_MODE=pnpm')
    expect(script).toContain('pnpm dlx --allow-build=node-pty --allow-build=protobufjs "@deepseek-ai/dsh@0.1.0-rc.8" "$@"')
    expect(script).toContain('pnpm dlx --allow-build=node-pty --allow-build=protobufjs "@deepseek-ai/dsh@0.1.0-rc.8" web --port "$PORT"')
    expect(script).not.toContain('"@deepseek-ai/dsh@0.1.0-rc.8" dsh')
    expect(script).toContain('DSH_MOUNT_PROBE=1')
    expect(script).toContain('DSH_CMD="${DSH_CMD-}"')
    expect(script).toContain('DSH_CMD 无效')
    expect(script).toContain('typeof value.quarantine !== "string"')
    expect(script).not.toContain('DSH_CMD="${DSH_CMD:-dsh}"')
    expect(script).not.toContain('npx -y --package')
    expect(script).toContain('@deepseek-ai/dsh@0.1.0-rc.8')
    expect(script).not.toContain('for candidate in "$ROOT"/dsh-better-sidebar-*.tgz')
    expect(readFileSync(resolve(process.cwd(), 'scripts/safe-temp.mjs'), 'utf8')).toContain('SIGKILL')
  })

  it('executes the pinned rc.8 bin directly and passes scoped build approvals', () => {
    const sandbox = mkdtempSync(join(tmpdir(), 'dsh-mount-probe.'))
    const fakeBin = join(sandbox, 'bin')
    const capture = join(sandbox, 'argv.json')
    mkdirSync(fakeBin)
    const fakePnpm = join(fakeBin, 'pnpm')
    writeFileSync(fakePnpm, '#!/usr/bin/env node\nconst fs = require("node:fs"); fs.writeFileSync(process.env.DSH_PROBE_CAPTURE, JSON.stringify(process.argv.slice(2))); if (process.argv.includes("--version")) process.stdout.write("0.1.0-rc.8\\n")\n')
    chmodSync(fakePnpm, 0o755)
    try {
      const pathKey = process.platform === 'win32' ? ';' : ':'
      const result = spawnSync('bash', [resolve(process.cwd(), 'scripts/e2e-mount.sh')], {
        env: { ...process.env, DSH_MOUNT_PROBE: '1', DSH_PROBE_CAPTURE: capture, PATH: `${fakeBin}${pathKey}${process.env.PATH ?? ''}` },
        encoding: 'utf8',
      })
      if ((result.error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') return
      expect(result.status, result.stderr).toBe(0)
      expect(JSON.parse(readFileSync(capture, 'utf8'))).toEqual([
        'dlx', '--allow-build=node-pty', '--allow-build=protobufjs', '@deepseek-ai/dsh@0.1.0-rc.8', '--version',
      ])
    } finally {
      rmSync(sandbox, { recursive: true, force: true })
    }
  })

  it('keeps production remove immune to pause-hook environment variables', () => {
    const { sandbox, root, base } = createSandbox()
    const pause = join(sandbox, 'pause')
    try {
      const owned = createOwned(base, root)
      const result = spawnSync(process.execPath, [helper, 'remove', owned.scratch, base, root, 'dsh-safety.', owned.token], {
        env: { ...process.env, NODE_ENV: 'test', DSH_SAFE_TEMP_PAUSE_DIR: pause }, encoding: 'utf8',
      })
      expect(result.status).toBe(0)
      expect(existsSync(pause)).toBe(false)
      const disabledOwner = createOwned(base, root)
      const pauseToken = randomBytes(32).toString('hex')
      const disabled = spawnSync(process.execPath, [helper, 'remove-test', disabledOwner.scratch, base, root, 'dsh-safety.', disabledOwner.token, pause, pauseToken], {
        env: { ...process.env, NODE_ENV: 'production' }, encoding: 'utf8',
      })
      expect(disabled.status).not.toBe(0)
      expect(existsSync(disabledOwner.scratch)).toBe(true)
      expect(invoke('remove', disabledOwner.scratch, base, root, 'dsh-safety.', disabledOwner.token).status).toBe(0)
    } finally {
      rmSync(sandbox, { recursive: true, force: true })
    }
  })

  it('contains no recursive deletion API in the cleanup helper', () => {
    const source = readFileSync(resolve(process.cwd(), 'scripts/safe-temp.mjs'), 'utf8')
    expect(source).not.toContain('rmSync')
    expect(source).not.toContain('rm -rf')
    expect(source).toContain('stat.dev.toString()')
    expect(source).toContain('stat.ino.toString()')
  })

  it('launches a Windows .cmd shim with metacharacter arguments unchanged', async () => {
    if (process.platform !== 'win32') return
    const { sandbox } = createSandbox()
    const hostilePath = join(sandbox, 'path %PATH% !bang ^caret (paren) & spaces')
    const targetPath = join(sandbox, 'target')
    mkdirSync(hostilePath)
    mkdirSync(targetPath)
    const shim = join(targetPath, 'explicit-override.cmd')
    const capture = join(targetPath, 'capture.mjs')
    const output = join(targetPath, 'argv.json')
    const pidFile = join(hostilePath, 'shim.pid')
    const logFile = join(hostilePath, 'shim.log')
    const sentinel = join(sandbox, 'PWNED.txt')
    const combined = `combo"& echo PWNED > "${sentinel}" & rem "z`
    const expected = ['%NAME%', '%PATH%', 'caret^x', 'bang!x', 'paren(x)', 'angle<in>', 'angle>out', 'alpha&beta', 'semi;pipe|', 'quoted"arg', combined]
    writeFileSync(capture, 'import fs from "node:fs"; fs.writeFileSync(process.argv[2], JSON.stringify(process.argv.slice(4)))\n')
    writeFileSync(shim, `@echo off\r\nnode "%~dp0capture.mjs" "%~dp0argv.json" %*\r\n`)
    try {
      const launcher = invokeAsync(['launch', pidFile, logFile, shim, output, ...expected])
      await new Promise<void>((resolve) => launcher.once('exit', () => resolve()))
      expect(launcher.exitCode).toBe(0)
      expect(JSON.parse(readFileSync(output, 'utf8'))).toEqual(expected)
      expect(existsSync(sentinel)).toBe(false)
    } finally {
      rmSync(sandbox, { recursive: true, force: true })
    }
  })

  it('propagates a Windows .cmd shim exit status exactly', async () => {
    if (process.platform !== 'win32') return
    const { sandbox } = createSandbox()
    const target = join(sandbox, 'status.cmd')
    const pidFile = join(sandbox, 'status.pid')
    const logFile = join(sandbox, 'status.log')
    writeFileSync(target, '@echo off\r\nexit /b 37\r\n')
    try {
      const launcher = invokeAsync(['launch', pidFile, logFile, target])
      await new Promise<void>((resolve) => launcher.once('exit', () => resolve()))
      expect(launcher.exitCode).toBe(37)
    } finally {
      rmSync(sandbox, { recursive: true, force: true })
    }
  })
})
