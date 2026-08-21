import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { delimiter, dirname, join, resolve } from 'node:path'
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

function fakeBinDir(fixture: SourceInstallFixture): string {
  const pathValue = fixture.env.PATH || fixture.env.Path || ''
  const bin = pathValue.split(delimiter)[0]
  if (!bin) throw new Error('fixture fake bin directory is missing from PATH')
  return bin
}

function removeFakeCommand(fixture: SourceInstallFixture, command: string): void {
  const bin = fakeBinDir(fixture)
  for (const suffix of ['', '.cmd']) {
    const path = join(bin, command + suffix)
    if (existsSync(path)) rmSync(path, { force: true })
  }
}

function installNpxProxy(fixture: SourceInstallFixture): string {
  const bin = fakeBinDir(fixture)
  const delegate = join(fixture.sandbox, 'delegated-dsh.js')
  copyFileSync(join(bin, 'dsh'), delegate)
  removeFakeCommand(fixture, 'dsh')
  const marker = join(fixture.sandbox, 'npx-used')
  const npx = join(bin, 'npx')
  writeFileSync(npx, `const fs = require('node:fs')
const cp = require('node:child_process')
fs.writeFileSync(${JSON.stringify(marker)}, 'used\\n')
const result = cp.spawnSync(process.execPath, [${JSON.stringify(delegate)}, ...process.argv.slice(2).slice(4)], { stdio: 'inherit' })
process.exit(result.status === null ? 1 : result.status)
`, { mode: 0o755 })
  writeFileSync(npx + '.cmd', '@echo off\r\nnode "%~dp0npx" %*\r\n')
  return marker
}

function installFailingNpx(fixture: SourceInstallFixture): void {
  const bin = fakeBinDir(fixture)
  const npx = join(bin, 'npx')
  writeFileSync(npx, 'process.stderr.write("unexpected npx invocation\\n")\nprocess.exit(91)\n', { mode: 0o755 })
  writeFileSync(npx + '.cmd', '@echo off\r\nnode "%~dp0npx" %*\r\n')
}

function installOneShotDsh(fixture: SourceInstallFixture): void {
  const bin = fakeBinDir(fixture)
  const dsh = join(bin, 'dsh')
  writeFileSync(dsh, `const fs = require('node:fs')
const callsFile = process.env.SOURCE_INSTALL_CALLS_FILE
const argv = process.argv.slice(2)
fs.appendFileSync(callsFile, JSON.stringify({ tool: 'dsh', argv, cwd: process.cwd() }) + '\\n')
if (argv.length === 1 && argv[0] === '--version') {
  process.stdout.write('0.1.0-rc.8\\n')
  try { fs.rmSync(__filename, { force: true }) } catch {}
  try { fs.rmSync(__filename + '.cmd', { force: true }) } catch {}
  process.exit(0)
}
process.stderr.write('one-shot dsh cannot launch plugin add\\n')
process.exit(2)
`, { mode: 0o755 })
}

function writeSourceManifests(fixture: SourceInstallFixture, mutate: (pkg: Record<string, unknown>, manifest: Record<string, unknown>) => void): void {
  const packagePath = join(fixture.repo, 'package.json')
  const manifestPath = join(fixture.repo, 'dsh.plugin.json')
  const pkg = JSON.parse(readFileSync(packagePath, 'utf8')) as Record<string, unknown>
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>
  mutate(pkg, manifest)
  writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + '\n')
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
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

  it('uses the PATH dsh executable for direct source probe and install', () => {
    const fixture = createSourceInstallFixture()
    fixtures.push(fixture)

    const result = runSource(fixture)

    expect(result.status).toBe(0)
    expect(readSourceCalls(fixture.callsFile).filter(call => call.tool === 'dsh').map(call => call.argv)).toEqual([
      ['--version'],
      ['plugin', '--profile', 'web', 'add', `file:${join(fixture.repo, '.artifacts', `dsh-better-sidebar-${SOURCE_VERSION}.tgz`)}`],
    ])
  })

  it('uses the npx fallback executable with its fixed dsh prefix when dsh is absent', () => {
    const fixture = createSourceInstallFixture()
    fixtures.push(fixture)
    const marker = installNpxProxy(fixture)

    const result = runSource(fixture)

    expect(result.status).toBe(0)
    expect(existsSync(marker)).toBe(true)
    expect(readSourceCalls(fixture.callsFile).filter(call => call.tool === 'dsh').map(call => call.argv)).toEqual([
      ['--version'],
      ['plugin', '--profile', 'web', 'add', `file:${join(fixture.repo, '.artifacts', `dsh-better-sidebar-${SOURCE_VERSION}.tgz`)}`],
    ])
  })

  it('uses a custom DSH_CMD executable for both source probe and install', () => {
    const fixture = createSourceInstallFixture()
    fixtures.push(fixture)
    fixture.env.DSH_CMD = join(fakeBinDir(fixture), 'dsh.cmd')
    installFailingNpx(fixture)

    const result = runSource(fixture)

    expect(result.status).toBe(0)
    expect(readSourceCalls(fixture.callsFile).filter(call => call.tool === 'dsh').map(call => call.argv)).toEqual([
      ['--version'],
      ['plugin', '--profile', 'web', 'add', `file:${join(fixture.repo, '.artifacts', `dsh-better-sidebar-${SOURCE_VERSION}.tgz`)}`],
    ])
  })

  it('fails closed when pnpm cannot launch even if an old tarball exists', () => {
    const fixture = createSourceInstallFixture()
    fixtures.push(fixture)
    const tarball = join(fixture.repo, '.artifacts', `dsh-better-sidebar-${SOURCE_VERSION}.tgz`)
    mkdirSync(join(fixture.repo, '.artifacts'), { recursive: true })
    writeFileSync(tarball, 'stale artifact\n')
    removeFakeCommand(fixture, 'pnpm')
    fixture.env.PATH = [fakeBinDir(fixture), dirname(process.execPath)].join(delimiter)
    fixture.env.Path = fixture.env.PATH

    const result = runSource(fixture)

    expect(result.status).not.toBe(0)
    expect(readFileSync(tarball, 'utf8')).toBe('stale artifact\n')
    expect(readSourceCalls(fixture.callsFile).some(call => call.tool === 'dsh' && call.argv[0] === 'plugin')).toBe(false)
    expect(existsSync(join(fixture.profileDir, 'node_modules', PACKAGE_NAME, 'package.json'))).toBe(false)
  })

  it('fails closed when dsh plugin add cannot launch after a successful probe', () => {
    const fixture = createSourceInstallFixture()
    fixtures.push(fixture)
    const profilePackagePath = join(fixture.profileDir, 'package.json')
    const profilePackage = JSON.parse(readFileSync(profilePackagePath, 'utf8')) as { dsh?: { profile?: { bundles?: string[] } } }
    profilePackage.dsh = { profile: { bundles: [PACKAGE_NAME] } }
    writeFileSync(profilePackagePath, JSON.stringify(profilePackage, null, 2) + '\n')
    const installedPath = join(fixture.profileDir, 'node_modules', PACKAGE_NAME)
    mkdirSync(installedPath, { recursive: true })
    writeFileSync(join(installedPath, 'package.json'), JSON.stringify({ name: PACKAGE_NAME, version: SOURCE_VERSION }, null, 2) + '\n')
    installOneShotDsh(fixture)

    const result = runSource(fixture)

    expect(result.status).not.toBe(0)
    expect(result.stdout + result.stderr).not.toContain('one-shot dsh cannot launch plugin add')
    expect(readSourceCalls(fixture.callsFile).filter(call => call.tool === 'dsh').map(call => call.argv)).toEqual([
      ['--version'],
    ])
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

  it.each([
    ['missing both source versions', (pkg: Record<string, unknown>, manifest: Record<string, unknown>) => {
      delete pkg.version
      delete manifest.version
    }],
    ['non-string package version', (pkg: Record<string, unknown>) => { pkg.version = 150001 }],
    ['non-string manifest version', (_pkg: Record<string, unknown>, manifest: Record<string, unknown>) => { manifest.version = 150001 }],
    ['case-sensitive package identity', (pkg: Record<string, unknown>) => { pkg.name = 'DSH-better-sidebar' }],
    ['case-sensitive version identity', (pkg: Record<string, unknown>) => { pkg.version = '0.15.0-XLH.1' }],
    ['inexact package identity', (pkg: Record<string, unknown>) => { pkg.name = 'dsh-better-sidebar-extra' }],
  ] as const)('rejects %s before any source tool call', (_name, mutate) => {
    const fixture = createSourceInstallFixture()
    fixtures.push(fixture)
    writeSourceManifests(fixture, mutate)

    const result = runSource(fixture)

    expect(result.status).not.toBe(0)
    expect(readSourceCalls(fixture.callsFile)).toEqual([])
    expect(existsSync(join(fixture.repo, '.artifacts'))).toBe(false)
  })
})
