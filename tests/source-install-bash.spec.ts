import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createSourceInstallFixture, readSourceCalls, type SourceCall, type SourceInstallFixture } from './helpers/source-install-fixture.ts'

const SOURCE_VERSION = '0.15.0-xlh.1'
const PACKAGE_NAME = 'dsh-better-sidebar'

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
  })

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
  })

  it('adds all four build approvals idempotently', () => {
    const fixture = createSourceInstallFixture()
    fixtures.push(fixture)

    expect(runSource(fixture).status).toBe(0)
    expect(runSource(fixture).status).toBe(0)

    const text = workspaceText(fixture)
    for (const key of ['allowBuilds:', 'node-pty: true', 'protobufjs: true', 'minimumReleaseAgeExclude:']) {
      expect(text.match(new RegExp(`^\\s*${key.replace(':', '\\:')}`, 'gm')) ?? []).toHaveLength(1)
    }
    expect(text.match(/^\s*-\s+['"]?@deepseek-ai\/\*['"]?\s*$/gm) ?? []).toHaveLength(1)
    expect(text.match(/^\s*-\s+dsh-better-sidebar\s*$/gm) ?? []).toHaveLength(1)
  }, 15_000)

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
  })

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
  })

  it('fails when installed version or bundle registration cannot be verified', () => {
    for (const options of [{ installedVersion: '0.15.0-xlh.0' }, { registerBundle: false }]) {
      const fixture = createSourceInstallFixture(options)
      fixtures.push(fixture)
      const result = runSource(fixture)
      expect(result.status).not.toBe(0)
    }
  })
})
