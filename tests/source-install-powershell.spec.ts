import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { createSourceInstallFixture, readSourceCalls, type SourceCall, type SourceInstallFixture } from './helpers/source-install-fixture.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE_VERSION = '0.15.0-xlh.1'
const PACKAGE_NAME = 'dsh-better-sidebar'

function detectPowerShell(): string | undefined {
  for (const candidate of ['pwsh', 'powershell']) {
    const probe = spawnSync(candidate, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', 'exit 0'], {
      stdio: 'ignore',
    })
    if (!probe.error && probe.status === 0) return candidate
  }
  return undefined
}

const POWERSHELL = detectPowerShell()

function runSource(fixture: SourceInstallFixture, ...args: string[]) {
  if (!POWERSHELL) throw new Error('PowerShell executable was not detected')
  return spawnSync(POWERSHELL, [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    join(fixture.repo, 'scripts', 'install.ps1'),
    '-Source',
    '-Profile',
    'web',
    ...args,
  ], {
    cwd: fixture.foreignCwd,
    env: fixture.env,
    encoding: 'utf8',
  })
}

function runParseCheck() {
  if (!POWERSHELL) throw new Error('PowerShell executable was not detected')
  return spawnSync(POWERSHELL, [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    '[void][scriptblock]::Create((Get-Content -Raw scripts/install.ps1))',
  ], {
    cwd: ROOT,
    encoding: 'utf8',
  })
}

function normalize(value: string): string {
  return value.replaceAll('\\', '/')
}

function normalizedCalls(calls: SourceCall[]): SourceCall[] {
  return calls.map(call => ({
    tool: call.tool,
    argv: call.argv.map(normalize),
    cwd: normalize(call.cwd),
  }))
}

function workspaceText(fixture: SourceInstallFixture): string {
  return readFileSync(join(fixture.profileDir, 'pnpm-workspace.yaml'), 'utf8')
}

describe.skipIf(!POWERSHELL)('PowerShell source installer', () => {
  const fixtures: SourceInstallFixture[] = []

  afterEach(() => {
    while (fixtures.length) fixtures.pop()!.cleanup()
  })

  it('has parseable PowerShell 5.1-compatible syntax', () => {
    const result = runParseCheck()
    expect(result.status).toBe(0)
    expect(result.error).toBeUndefined()
  })

  it('source dry-run performs no writes or fake tool calls', () => {
    const fixture = createSourceInstallFixture()
    fixtures.push(fixture)
    const workspaceBefore = workspaceText(fixture)
    const profileBefore = readFileSync(join(fixture.profileDir, 'package.json'), 'utf8')
    const patchBefore = readFileSync(join(fixture.profileDir, 'cordis.patch.yml'), 'utf8')

    const result = runSource(fixture, '-DryRun')

    expect(result.status).toBe(0)
    expect(result.stdout + result.stderr).toContain('[dry-run]')
    expect(normalize(result.stdout + result.stderr)).toContain(normalize(fixture.repo))
    expect(result.stdout + result.stderr).toContain(`dsh-better-sidebar-${SOURCE_VERSION}.tgz`)
    expect(workspaceText(fixture)).toBe(workspaceBefore)
    expect(readFileSync(join(fixture.profileDir, 'package.json'), 'utf8')).toBe(profileBefore)
    expect(readFileSync(join(fixture.profileDir, 'cordis.patch.yml'), 'utf8')).toBe(patchBefore)
    expect(existsSync(join(fixture.repo, '.artifacts'))).toBe(false)
    expect(readSourceCalls(fixture.callsFile)).toEqual([])
  })

  it('preserves the absolute non-ASCII tarball as one file argument', () => {
    const fixture = createSourceInstallFixture()
    fixtures.push(fixture)

    const result = runSource(fixture)

    expect(result.status).toBe(0)
    const tarball = join(fixture.repo, '.artifacts', `dsh-better-sidebar-${SOURCE_VERSION}.tgz`)
    expect(existsSync(tarball)).toBe(true)
    expect(normalizedCalls(readSourceCalls(fixture.callsFile))).toEqual([
      { tool: 'dsh', argv: ['--version'], cwd: normalize(fixture.repo) },
      { tool: 'pnpm', argv: ['install', '--frozen-lockfile'], cwd: normalize(fixture.repo) },
      { tool: 'pnpm', argv: ['build'], cwd: normalize(fixture.repo) },
      { tool: 'pnpm', argv: ['pack', '--pack-destination', normalize(join(fixture.repo, '.artifacts'))], cwd: normalize(fixture.repo) },
      { tool: 'dsh', argv: ['plugin', '--profile', 'web', 'add', `file:${normalize(tarball)}`], cwd: normalize(fixture.repo) },
    ])

    const installedPackage = JSON.parse(readFileSync(join(fixture.profileDir, 'node_modules', PACKAGE_NAME, 'package.json'), 'utf8')) as { version: string }
    expect(installedPackage.version).toBe(SOURCE_VERSION)
  })

  it('keeps four build approvals idempotent across repeated installs', () => {
    const fixture = createSourceInstallFixture()
    fixtures.push(fixture)

    expect(runSource(fixture).status).toBe(0)
    expect(runSource(fixture).status).toBe(0)

    const text = workspaceText(fixture)
    for (const packageName of ['node-pty', 'protobufjs', '@deepseek-ai/dsh-subprocess-local', 'koffi']) {
      const entries = text.split(/\r?\n/).filter(line => {
        const match = /^\s*(.+?):\s*true\s*$/.exec(line)
        return match?.[1]?.replace(/^['"]|['"]$/g, '') === packageName
      })
      expect(entries).toHaveLength(1)
    }
    expect(text.match(/^\s*allowBuilds:\s*$/gm) ?? []).toHaveLength(1)
    expect(text.match(/^\s*minimumReleaseAgeExclude:\s*$/gm) ?? []).toHaveLength(1)
    expect(text.match(/^\s*-\s+['"]?@deepseek-ai\/\*['"]?\s*$/gm) ?? []).toHaveLength(1)
    expect(text.match(/^\s*-\s+dsh-better-sidebar\s*$/gm) ?? []).toHaveLength(1)
  }, 15_000)

  it.each(['install', 'build', 'pack'] as const)('does not call dsh plugin add after pnpm %s failure', (command) => {
    const fixture = createSourceInstallFixture({ failPnpmCommand: command })
    fixtures.push(fixture)

    const result = runSource(fixture)

    expect(result.status).not.toBe(0)
    const expectedArgv = {
      install: [['--version'], ['install', '--frozen-lockfile']],
      build: [['--version'], ['install', '--frozen-lockfile'], ['build']],
      pack: [['--version'], ['install', '--frozen-lockfile'], ['build'], ['pack', '--pack-destination', normalize(join(fixture.repo, '.artifacts'))]],
    }[command]
    expect(normalizedCalls(readSourceCalls(fixture.callsFile))).toEqual(expectedArgv.map((argv, index) => ({
      tool: index === 0 ? 'dsh' : 'pnpm',
      argv,
      cwd: normalize(fixture.repo),
    })))
    expect(readSourceCalls(fixture.callsFile).some(call => call.tool === 'dsh' && call.argv[0] === 'plugin')).toBe(false)
    expect(existsSync(join(fixture.profileDir, 'node_modules', PACKAGE_NAME, 'package.json'))).toBe(false)
  })

  it('rejects wrong DSH and failed version or bundle verification', () => {
    const wrongDsh = createSourceInstallFixture({ dshVersion: '0.1.0-rc.7' })
    fixtures.push(wrongDsh)
    const workspaceBefore = workspaceText(wrongDsh)
    const profileBefore = readFileSync(join(wrongDsh.profileDir, 'package.json'), 'utf8')

    const wrongDshResult = runSource(wrongDsh)

    expect(wrongDshResult.status).not.toBe(0)
    expect(wrongDshResult.stdout + wrongDshResult.stderr).toContain('0.1.0-rc.7')
    expect(normalizedCalls(readSourceCalls(wrongDsh.callsFile))).toEqual([{
      tool: 'dsh', argv: ['--version'], cwd: normalize(wrongDsh.repo),
    }])
    expect(workspaceText(wrongDsh)).toBe(workspaceBefore)
    expect(readFileSync(join(wrongDsh.profileDir, 'package.json'), 'utf8')).toBe(profileBefore)

    for (const options of [{ installedVersion: '0.15.0-xlh.0' }, { registerBundle: false }]) {
      const fixture = createSourceInstallFixture(options)
      fixtures.push(fixture)
      const result = runSource(fixture)
      expect(result.status).not.toBe(0)
    }
  })
})
