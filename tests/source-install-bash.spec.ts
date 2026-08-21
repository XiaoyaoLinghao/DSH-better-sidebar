import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { delimiter, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createSourceInstallFixture, readSourceCalls, type SourceCall, type SourceInstallFixture } from './helpers/source-install-fixture.ts'

const SOURCE_VERSION = '0.15.0-xlh.1'
const PACKAGE_NAME = 'dsh-better-sidebar'
const INTEGRATION_TIMEOUT = 30_000

function runSource(fixture: SourceInstallFixture, ...args: string[]) {
  return spawnSync('bash', [join(fixture.repo, 'scripts', 'install.sh'), '--source', '--profile', 'web', ...args], {
    cwd: fixture.foreignCwd,
    env: fixture.env,
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

describe('Bash source installer', () => {
  const fixtures: SourceInstallFixture[] = []

  afterEach(() => {
    while (fixtures.length) fixtures.pop()!.cleanup()
  })

  it('dry-run reports source actions and performs no writes or child calls', () => {
    const fixture = createSourceInstallFixture()
    fixtures.push(fixture)
    const workspaceBefore = workspaceText(fixture)
    const profileBefore = readFileSync(join(fixture.profileDir, 'package.json'), 'utf8')
    const patchBefore = readFileSync(join(fixture.profileDir, 'cordis.patch.yml'), 'utf8')

    const result = runSource(fixture, '--dry-run')

    expect(result.status).toBe(0)
    expect(result.stdout + result.stderr).toContain('[dry-run]')
    expect(normalize(result.stdout + result.stderr)).toContain(normalize(fixture.repo))
    expect(result.stdout + result.stderr).toContain(`dsh-better-sidebar-${SOURCE_VERSION}.tgz`)
    expect(workspaceText(fixture)).toBe(workspaceBefore)
    expect(readFileSync(join(fixture.profileDir, 'package.json'), 'utf8')).toBe(profileBefore)
    expect(readFileSync(join(fixture.profileDir, 'cordis.patch.yml'), 'utf8')).toBe(patchBefore)
    expect(existsSync(join(fixture.repo, '.artifacts'))).toBe(false)
    expect(readSourceCalls(fixture.callsFile)).toEqual([])
  }, INTEGRATION_TIMEOUT)

  it('fails dry-run when neither dsh nor npx is available without writes or child calls', () => {
    const fixture = createSourceInstallFixture()
    fixtures.push(fixture)
    const bin = join(fixture.sandbox, 'fake bin')
    for (const command of ['dsh', 'npx']) {
      rmSync(join(bin, command), { force: true })
      rmSync(join(bin, `${command}.cmd`), { force: true })
    }
    copyFileSync(process.execPath, join(bin, 'node.exe'))
    writeFileSync(join(bin, 'node'), `#!/bin/sh
exec "${process.execPath.replaceAll('\\', '/')}" "$@"
`, { mode: 0o755 })
    chmodSync(join(bin, 'node'), 0o755)
    const bashDir = (process.env.PATH ?? '').split(delimiter).find(entry => existsSync(join(entry, 'bash.exe')))
    if (!bashDir) throw new Error('test requires a Bash executable directory')
    fixture.env.PATH = [bin, bashDir].join(delimiter)
    fixture.env.Path = fixture.env.PATH

    const result = runSource(fixture, '--dry-run')

    const output = result.stdout + result.stderr
    expect(result.status, `${output} ${result.error?.message ?? ''}`).not.toBe(0)
    expect(output, result.error?.message ?? '').toContain('未找到 dsh 或 npx')
    expect(result.stdout + result.stderr).not.toContain('[dry-run] 步骤 5')
    expect(readSourceCalls(fixture.callsFile)).toEqual([])
    expect(existsSync(join(fixture.repo, '.artifacts'))).toBe(false)
  }, INTEGRATION_TIMEOUT)

  it('builds from the script repository and installs one absolute file tarball', () => {
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
  }, INTEGRATION_TIMEOUT)

  it('preserves a custom DSH_CMD executable path containing spaces', () => {
    const fixture = createSourceInstallFixture()
    fixtures.push(fixture)
    const customDir = join(fixture.sandbox, 'custom dsh bin')
    const customExecutable = join(customDir, 'dsh')
    mkdirSync(customDir, { recursive: true })
    copyFileSync(join(fixture.sandbox, 'fake bin', 'dsh'), customExecutable)
    chmodSync(customExecutable, 0o755)
    fixture.env.DSH_CMD = customExecutable

    const result = runSource(fixture)

    expect(result.status, result.stdout + result.stderr).toBe(0)
    expect(readSourceCalls(fixture.callsFile).filter(call => call.tool === 'dsh').map(call => call.argv.map(normalize))).toEqual([
      ['--version'],
      ['plugin', '--profile', 'web', 'add', `file:${normalize(join(fixture.repo, '.artifacts', `dsh-better-sidebar-${SOURCE_VERSION}.tgz`))}`],
    ])
  }, INTEGRATION_TIMEOUT)

  it('adds all four build approvals idempotently', () => {
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
  }, INTEGRATION_TIMEOUT)

  it.each(['install', 'build', 'pack'] as const)('stops before plugin add when pnpm %s fails', (command) => {
    const fixture = createSourceInstallFixture({ failPnpmCommand: command })
    fixtures.push(fixture)

    const result = runSource(fixture)

    expect(result.status).not.toBe(0)
    const calls = readSourceCalls(fixture.callsFile)
    const expectedArgv = {
      install: [['--version'], ['install', '--frozen-lockfile']],
      build: [['--version'], ['install', '--frozen-lockfile'], ['build']],
      pack: [['--version'], ['install', '--frozen-lockfile'], ['build'], ['pack', '--pack-destination', normalize(join(fixture.repo, '.artifacts'))]],
    }[command]
    expect(normalizedCalls(calls)).toEqual(expectedArgv.map((argv, index) => ({
      tool: index === 0 ? 'dsh' : 'pnpm',
      argv,
      cwd: normalize(fixture.repo),
    })))
    expect(calls.some(call => call.tool === 'dsh' && call.argv[0] === 'plugin')).toBe(false)
    expect(existsSync(join(fixture.profileDir, 'node_modules', PACKAGE_NAME, 'package.json'))).toBe(false)
  }, INTEGRATION_TIMEOUT)

  it('rejects a DSH version other than 0.1.0-rc.8 before profile writes', () => {
    const fixture = createSourceInstallFixture({ dshVersion: '0.1.0-rc.7' })
    fixtures.push(fixture)
    const workspaceBefore = workspaceText(fixture)
    const profileBefore = readFileSync(join(fixture.profileDir, 'package.json'), 'utf8')

    const result = runSource(fixture)

    expect(result.status).not.toBe(0)
    expect(result.stdout + result.stderr).toContain('0.1.0-rc.7')
    expect(normalizedCalls(readSourceCalls(fixture.callsFile))).toEqual([{
      tool: 'dsh', argv: ['--version'], cwd: normalize(fixture.repo),
    }])
    expect(workspaceText(fixture)).toBe(workspaceBefore)
    expect(readFileSync(join(fixture.profileDir, 'package.json'), 'utf8')).toBe(profileBefore)
  }, INTEGRATION_TIMEOUT)

  it('fails when installed version or bundle registration cannot be verified', () => {
    for (const options of [{ installedVersion: '0.15.0-xlh.0' }, { registerBundle: false }]) {
      const fixture = createSourceInstallFixture(options)
      fixtures.push(fixture)
      const result = runSource(fixture)
      expect(result.status).not.toBe(0)
    }
  }, INTEGRATION_TIMEOUT)
})
