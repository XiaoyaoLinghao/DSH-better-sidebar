import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface SourceCall {
  tool: 'pnpm' | 'dsh'
  argv: string[]
  cwd: string
}

export interface SourceInstallFixture {
  sandbox: string
  repo: string
  foreignCwd: string
  dshHome: string
  profileDir: string
  callsFile: string
  env: NodeJS.ProcessEnv
  cleanup(): void
}

const PACKAGE_NAME = 'dsh-better-sidebar'
const SOURCE_VERSION = '0.15.0-xlh.1'

/**
 * Build an isolated profile and source checkout for the real Bash installer.
 * The fake CLIs are deliberately tiny: they only record calls and implement
 * the external side effects the installer is expected to verify.
 */
export function createSourceInstallFixture(options: {
  failPnpmCommand?: 'install' | 'build' | 'pack'
  dshVersion?: string
  registerBundle?: boolean
  installedVersion?: string
} = {}): SourceInstallFixture {
  const rawSandbox = mkdtempSync(join(tmpdir(), 'dsh-source-install-'))
  mkdirSync(join(rawSandbox, '.canonical-path-marker'))
  const sandbox = dirname(realpathSync.native(join(rawSandbox, '.canonical-path-marker')))
  const repo = join(sandbox, '源码 repo with spaces')
  const foreignCwd = join(sandbox, 'foreign cwd')
  const dshHome = join(sandbox, 'dsh home')
  const profileDir = join(dshHome, 'profiles', 'web')
  const binDir = join(sandbox, 'fake bin')
  const callsFile = join(sandbox, 'source calls.jsonl')

  mkdirSync(join(repo, 'scripts'), { recursive: true })
  mkdirSync(foreignCwd, { recursive: true })
  mkdirSync(profileDir, { recursive: true })
  mkdirSync(binDir, { recursive: true })

  const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
  for (const file of ['scripts/install.sh', 'scripts/install.ps1', 'package.json', 'dsh.plugin.json', 'pnpm-lock.yaml']) {
    const destination = join(repo, file)
    mkdirSync(join(destination, '..'), { recursive: true })
    copyFileSync(join(sourceRoot, file), destination)
  }

  writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
    name: 'dsh-profile-web',
    dsh: { profile: { bundles: [] } },
  }, null, 2) + '\n')
  writeFileSync(join(profileDir, 'pnpm-workspace.yaml'), 'packages:\n  - .\n')
  writeFileSync(join(profileDir, 'cordis.patch.yml'), '# fixture patch\n')

  const pnpmScript = `#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')

const callsFile = process.env.SOURCE_INSTALL_CALLS_FILE
const argv = process.argv.slice(2)
const call = { tool: 'pnpm', argv, cwd: process.cwd() }
if (!callsFile) throw new Error('SOURCE_INSTALL_CALLS_FILE is not set')
fs.appendFileSync(callsFile, JSON.stringify(call) + '\\n')

const failCommand = process.env.SOURCE_INSTALL_FAIL_PNPM
if (failCommand && argv[0] === failCommand) {
  process.stderr.write('fake pnpm failure: ' + failCommand + '\\n')
  process.exit(17)
}

if (argv[0] === 'pack') {
  const destinationIndex = argv.indexOf('--pack-destination')
  if (destinationIndex < 0 || !argv[destinationIndex + 1]) {
    process.stderr.write('fake pnpm pack requires --pack-destination\\n')
    process.exit(2)
  }
  const destination = argv[destinationIndex + 1]
  fs.mkdirSync(destination, { recursive: true })
  const tarball = path.join(destination, 'dsh-better-sidebar-0.15.0-xlh.1.tgz')
  fs.writeFileSync(tarball, 'fake source tarball\\n')
}
`
  const dshScript = `#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')

const callsFile = process.env.SOURCE_INSTALL_CALLS_FILE
const argv = process.argv.slice(2)
const call = { tool: 'dsh', argv, cwd: process.cwd() }
if (!callsFile) throw new Error('SOURCE_INSTALL_CALLS_FILE is not set')
fs.appendFileSync(callsFile, JSON.stringify(call) + '\\n')

if (argv.length === 1 && argv[0] === '--version') {
  process.stdout.write((process.env.SOURCE_INSTALL_DSH_VERSION || '0.1.0-rc.8') + '\\n')
  process.exit(0)
}

if (argv[0] === 'plugin' && argv[1] === '--profile' && argv[3] === 'add') {
  const profileName = argv[2]
  const spec = argv[4]
  if (!profileName || !spec || !spec.startsWith('file:')) {
    process.stderr.write('fake dsh plugin add requires an absolute file spec\\n')
    process.exit(2)
  }
  const dshHome = process.env.DSH_HOME
  if (!dshHome) throw new Error('DSH_HOME is not set')
  const profileDir = path.join(dshHome, 'profiles', profileName)
  const packageDir = path.join(profileDir, 'node_modules', 'dsh-better-sidebar')
  fs.mkdirSync(packageDir, { recursive: true })
  fs.writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({
    name: 'dsh-better-sidebar',
    version: process.env.SOURCE_INSTALL_INSTALLED_VERSION || '0.15.0-xlh.1',
  }, null, 2) + '\\n')

  const profilePackagePath = path.join(profileDir, 'package.json')
  const profilePackage = JSON.parse(fs.readFileSync(profilePackagePath, 'utf8'))
  profilePackage.dsh ??= {}
  profilePackage.dsh.profile ??= {}
  profilePackage.dsh.profile.bundles ??= []
  if (process.env.SOURCE_INSTALL_REGISTER_BUNDLE !== 'false'
      && !profilePackage.dsh.profile.bundles.includes('dsh-better-sidebar')) {
    profilePackage.dsh.profile.bundles.push('dsh-better-sidebar')
  }
  fs.writeFileSync(profilePackagePath, JSON.stringify(profilePackage, null, 2) + '\\n')
  process.exit(0)
}

process.stderr.write('fake dsh received unsupported argv\\n')
process.exit(2)
`
  writeFileSync(join(binDir, 'pnpm'), pnpmScript, { mode: 0o755 })
  writeFileSync(join(binDir, 'dsh'), dshScript, { mode: 0o755 })
  writeFileSync(join(binDir, 'pnpm.cmd'), '@echo off\r\nnode "%~dp0pnpm" %*\r\n')
  writeFileSync(join(binDir, 'dsh.cmd'), '@echo off\r\nnode "%~dp0dsh" %*\r\n')

  const existingPath = process.env.PATH ?? process.env.Path ?? ''
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DSH_HOME: dshHome,
    SOURCE_INSTALL_CALLS_FILE: callsFile,
    SOURCE_INSTALL_DSH_VERSION: options.dshVersion ?? '0.1.0-rc.8',
    SOURCE_INSTALL_FAIL_PNPM: options.failPnpmCommand ?? '',
    SOURCE_INSTALL_INSTALLED_VERSION: options.installedVersion ?? SOURCE_VERSION,
    SOURCE_INSTALL_REGISTER_BUNDLE: options.registerBundle === false ? 'false' : 'true',
    PATH: [binDir, existingPath].filter(Boolean).join(delimiter),
  }
  if (process.platform === 'win32') env.Path = env.PATH

  return {
    sandbox,
    repo,
    foreignCwd,
    dshHome,
    profileDir,
    callsFile,
    env,
    cleanup: () => {
      if (existsSync(sandbox)) rmSync(sandbox, { recursive: true, force: true })
    },
  }
}

export function readSourceCalls(path: string): SourceCall[] {
  if (!existsSync(path)) return []
  const text = readFileSync(path, 'utf8')
  return text.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line) as SourceCall)
}
