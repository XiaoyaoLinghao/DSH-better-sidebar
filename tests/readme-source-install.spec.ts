import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { createSourceInstallFixture, readSourceCalls, type SourceInstallFixture } from './helpers/source-install-fixture.ts'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const SOURCE_VERSION = '0.15.0-xlh.1'
const PACKAGE_NAME = 'dsh-better-sidebar'

/** Extract the one-line command immediately following a README source marker. */
export function commandAfterMarker(readme: string, marker: 'bash' | 'powershell'): string {
  const markerText = `<!-- source-install:${marker} -->`
  const occurrences = readme.split(markerText).length - 1
  if (occurrences !== 1) {
    throw new Error(`expected exactly one ${markerText} marker, found ${occurrences}`)
  }

  const markerIndex = readme.indexOf(markerText)
  const afterMarker = readme.slice(markerIndex + markerText.length)
  const fence = new RegExp('^\\r?\\n```' + marker + '\\r?\\n([^\\r\\n]+)\\r?\\n```')
  const match = fence.exec(afterMarker)
  if (!match) {
    throw new Error(`expected an adjacent ${marker} fenced command`)
  }

  const commandCapture = match[1]
  if (commandCapture === undefined) {
    throw new Error(`expected a captured ${marker} source command`)
  }
  const command = commandCapture.trim()
  if (!command || /[\r\n]/u.test(command)) {
    throw new Error(`${marker} source command must be a non-empty single line`)
  }
  return command
}

function readmes(): Array<{ name: string; path: string }> {
  return [
    { name: 'Chinese README', path: join(ROOT, 'README.md') },
    { name: 'English README', path: join(ROOT, 'README_EN.md') },
  ]
}

function executableFor(command: string): string {
  if (command !== 'powershell') return command
  for (const candidate of ['pwsh', 'powershell']) {
    const probe = spawnSync(candidate, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', 'exit 0'], {
      stdio: 'ignore',
    })
    if (!probe.error && probe.status === 0) return candidate
  }
  throw new Error('PowerShell executable was not detected')
}

function runDocumentedCommand(fixture: SourceInstallFixture, command: string) {
  const argv = command.trim().split(/\s+/u)
  const commandName = argv.shift()
  if (commandName === undefined) {
    throw new Error('documented source command must include an executable')
  }
  const executable = executableFor(commandName)
  return spawnSync(executable, argv, {
    cwd: fixture.repo,
    env: fixture.env,
    encoding: 'utf8',
    shell: false,
  })
}

function assertSourceInstall(fixture: SourceInstallFixture, result: ReturnType<typeof spawnSync>): void {
  const stdout = result.stdout?.toString() ?? ''
  const stderr = result.stderr?.toString() ?? ''
  expect(result.status, stdout + stderr).toBe(0)

  const installed = JSON.parse(readFileSync(join(
    fixture.profileDir,
    'node_modules',
    PACKAGE_NAME,
    'package.json',
  ), 'utf8')) as { version: string }
  expect(installed.version).toBe(SOURCE_VERSION)

  const profile = JSON.parse(readFileSync(join(fixture.profileDir, 'package.json'), 'utf8')) as {
    dsh?: { profile?: { bundles?: string[] } }
  }
  expect(profile.dsh?.profile?.bundles).toContain(PACKAGE_NAME)

  const tarballCalls = readSourceCalls(fixture.callsFile).filter(call =>
    call.tool === 'dsh'
    && call.argv[0] === 'plugin'
    && call.argv.filter(argument => argument.startsWith('file:')).length === 1,
  )
  expect(tarballCalls).toHaveLength(1)
  const tarballCall = tarballCalls[0]
  if (tarballCall === undefined) {
    throw new Error('expected exactly one source tarball dsh call')
  }
  const tarballPath = tarballCall.argv.find(argument => argument.startsWith('file:'))
  if (tarballPath === undefined) {
    throw new Error('expected source tarball dsh call to include a file: path')
  }
  expect(tarballPath).toMatch(/^file:[A-Za-z]:[\\/]|^file:\//u)
}

describe('README source-install command contract', () => {
  const fixtures: SourceInstallFixture[] = []

  afterEach(() => {
    while (fixtures.length) fixtures.pop()!.cleanup()
  })

  it('requires exactly one adjacent fenced single-line command for each marker', () => {
    const valid = '<!-- source-install:bash -->\n```bash\nbash scripts/install.sh --source --profile web\n```'
    expect(commandAfterMarker(valid, 'bash')).toBe('bash scripts/install.sh --source --profile web')
    expect(() => commandAfterMarker('no marker', 'bash')).toThrow(/marker/u)
    expect(() => commandAfterMarker(`${valid}\n${valid}`, 'bash')).toThrow(/exactly one/u)
    expect(() => commandAfterMarker('<!-- source-install:bash -->\ntext', 'bash')).toThrow(/adjacent/u)
    expect(() => commandAfterMarker('<!-- source-install:bash -->\n```bash\nbash scripts/install.sh\nextra\n```', 'bash')).toThrow(/adjacent/u)
  })

  for (const readme of readmes()) {
    const text = readFileSync(readme.path, 'utf8')
    for (const marker of ['bash', 'powershell'] as const) {
      it(`${readme.name} ${marker} command installs the source bundle`, () => {
        const fixture = createSourceInstallFixture()
        fixtures.push(fixture)
        const command = commandAfterMarker(text, marker)
        const result = runDocumentedCommand(fixture, command)
        assertSourceInstall(fixture, result)
      }, 30_000)
    }
  }
})
