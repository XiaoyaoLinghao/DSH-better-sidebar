import { spawn, spawnSync } from 'node:child_process'
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const helper = resolve(process.cwd(), 'scripts/safe-temp.mjs')

function invoke(...args: string[]) {
  return spawnSync(process.execPath, [helper, ...args], { encoding: 'utf8' })
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
      expect(invoke('remove', owned.scratch, base, root, 'dsh-safety.', owned.token).status).toBe(0)
      expect(invoke('remove', owned.scratch, base, root, 'dsh-safety.', owned.token).status).toBe(0)
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

  it('keeps the mount script on the fresh-pack and isolated-launch contract', () => {
    const script = readFileSync(resolve(process.cwd(), 'scripts/e2e-mount.sh'), 'utf8')
    expect(script).toContain('pnpm pack --pack-destination "$SCRATCH"')
    expect(script).toContain('node "$SAFE_TEMP" launch')
    expect(script).toContain('@deepseek-ai/dsh@0.1.0-rc.8')
    expect(script).not.toContain('for candidate in "$ROOT"/dsh-better-sidebar-*.tgz')
  })
})
