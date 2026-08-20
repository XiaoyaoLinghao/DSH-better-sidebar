#!/usr/bin/env node

// Scratch cleanup is deliberately non-destructive: owned directories are
// atomically quarantined and left for explicit OS-temp reclamation.
import crypto from 'node:crypto'
import fs from 'node:fs'
import { execFileSync, spawn } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'

const VERSION = 1
const MARKER_NAME = '.dsh-verification-owner.json'
const TOKEN_RE = /^[a-f0-9]{64}$/

function fail(message) {
  throw new Error(message)
}

function absolute(value, label) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) fail(`${label} is required`)
  return path.resolve(value)
}

function canonicalExisting(value, label) {
  const resolved = absolute(value, label)
  let canonical
  try {
    canonical = fs.realpathSync.native(resolved)
  } catch {
    fail(`${label} does not exist: ${resolved}`)
  }
  if (!fs.statSync(canonical).isDirectory()) fail(`${label} is not a directory: ${resolved}`)
  return canonical
}

function canonicalMaybeMissing(value, label) {
  let current = absolute(value, label)
  const tail = []
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current)
    if (parent === current) fail(`${label} has no existing ancestor: ${current}`)
    tail.unshift(path.basename(current))
    current = parent
  }
  return path.join(fs.realpathSync.native(current), ...tail)
}

function withinOrEqual(child, parent) {
  const relative = path.relative(parent, child)
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
}

function strictDescendant(child, parent) {
  return child !== parent && withinOrEqual(child, parent)
}

function assertNoRootBaseOverlap(root, base) {
  if (withinOrEqual(root, base) || withinOrEqual(base, root)) fail('repository root and scratch base overlap')
}

function assertScratchIdentity(scratch, base, root, prefix) {
  if (!strictDescendant(scratch, base)) fail('scratch must be a strict descendant of scratch base')
  if (withinOrEqual(scratch, root) || withinOrEqual(root, scratch)) fail('scratch overlaps repository root')
  if (!path.basename(scratch).startsWith(prefix)) fail('scratch basename has unexpected prefix')
}

function assertPrefix(prefix) {
  if (typeof prefix !== 'string' || prefix.length === 0 || prefix.includes('/') || prefix.includes('\\') || prefix.includes('\0')) fail('invalid scratch prefix')
}

function assertToken(token) {
  if (typeof token !== 'string' || !TOKEN_RE.test(token)) fail('invalid ownership token')
}

function receiptPath(scratch, token) {
  assertToken(token)
  return path.join(scratch, `.dsh-verification-receipt-${crypto.createHash('sha256').update(token).digest('hex')}.json`)
}

function writeExclusive(file, value, mode) {
  fs.writeFileSync(file, `${JSON.stringify(value)}\n`, { flag: 'wx', mode })
}

function readJsonFile(file, label) {
  let stat
  try {
    stat = fs.lstatSync(file)
  } catch {
    fail(`${label} is missing`)
  }
  if (!stat.isFile() || stat.isSymbolicLink()) fail(`${label} is not a regular file`)
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    fail(`${label} is not valid JSON`)
  }
}

function assertRecord(record, expected) {
  for (const key of ['version', 'base', 'root', 'scratch', 'token', 'prefix']) {
    if (record?.[key] !== expected[key]) fail(`ownership record ${key} mismatch`)
  }
  if (expected.identity && !sameIdentity(record?.identity, expected.identity)) fail('ownership record identity mismatch')
}

function identityFor(value, label = 'scratch') {
  const canonical = fs.realpathSync.native(absolute(value, label))
  const stat = fs.statSync(canonical, { bigint: true })
  const dev = stat.dev.toString()
  const ino = stat.ino.toString()
  return { realpath: canonical, dev, ino, supported: dev !== '0' && ino !== '0' }
}

function sameIdentity(actual, expected, requirePath = false) {
  if (!actual || !expected) return false
  if (requirePath && actual.realpath !== expected.realpath) return false
  if (!actual.supported || !expected.supported) return false
  return actual.dev === expected.dev && actual.ino === expected.ino
}

function quarantinePath(base, prefix, token) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const candidate = path.join(base, `.${prefix}quarantine-${token.slice(0, 16)}-${crypto.randomBytes(8).toString('hex')}`)
    if (!fs.existsSync(candidate)) return candidate
  }
  fail('could not allocate a quarantine path')
}

function pauseAfterValidation(root, pauseArg, pauseToken, stage) {
  if (process.env.NODE_ENV !== 'test') fail('test pause command requires NODE_ENV=test')
  assertToken(pauseToken)
  const pause = absolute(pauseArg, 'test pause directory')
  const tempRoot = fs.realpathSync.native(os.tmpdir())
  const parent = canonicalExisting(path.dirname(pause), 'test pause parent')
  const pauseCanonical = canonicalMaybeMissing(pause, 'test pause directory')
  if (!withinOrEqual(pauseCanonical, tempRoot) || withinOrEqual(pauseCanonical, root) || withinOrEqual(root, pauseCanonical)) fail('test pause directory is outside temporary root')
  if (!withinOrEqual(pauseCanonical, parent)) fail('test pause directory escapes temporary parent')
  fs.mkdirSync(pause, { recursive: true })
  writeExclusive(path.join(pause, `ready.${stage}.${pauseToken}`), { version: VERSION }, 0o600)
  const deadline = Date.now() + 10_000
  while (!fs.existsSync(path.join(pause, `go.${stage}.${pauseToken}`))) {
    if (Date.now() > deadline) fail('test pause timed out')
    const wait = new Int32Array(new SharedArrayBuffer(4))
    Atomics.wait(wait, 0, 0, 20)
  }
}

function canonicalRoots(baseArg, rootArg, createBase = false) {
  const root = canonicalExisting(rootArg, 'repository root')
  if (!createBase) {
    const base = canonicalExisting(baseArg, 'scratch base')
    assertNoRootBaseOverlap(root, base)
    return { base, root }
  }
  const baseRequested = absolute(baseArg, 'scratch base')
  const basePredicted = canonicalMaybeMissing(baseRequested, 'scratch base')
  assertNoRootBaseOverlap(root, basePredicted)
  fs.mkdirSync(baseRequested, { recursive: true })
  const base = canonicalExisting(baseRequested, 'scratch base')
  assertNoRootBaseOverlap(root, base)
  return { base, root }
}

function create(baseArg, rootArg, prefix) {
  assertPrefix(prefix)
  const { base, root } = canonicalRoots(baseArg, rootArg, true)
  let scratch
  let createdIdentity
  let token
  try {
    scratch = fs.realpathSync.native(fs.mkdtempSync(path.join(base, prefix)))
    assertScratchIdentity(scratch, base, root, prefix)
    createdIdentity = identityFor(scratch)
    token = crypto.randomBytes(32).toString('hex')
    const record = { version: VERSION, base, root, scratch, token, prefix, identity: createdIdentity }
    writeExclusive(receiptPath(scratch, token), record, 0o600)
    writeExclusive(path.join(scratch, MARKER_NAME), record, 0o600)
    process.stdout.write(`${JSON.stringify({ version: VERSION, scratch, token })}\n`)
  } catch (error) {
    if (scratch && createdIdentity) {
      try {
        const current = identityFor(scratch)
        if (!sameIdentity(current, createdIdentity, true)) fail('created scratch identity changed during setup')
        const quarantine = quarantinePath(base, prefix, token || crypto.randomBytes(32).toString('hex'))
        fs.renameSync(scratch, quarantine)
        const quarantined = identityFor(quarantine)
        if (!sameIdentity(quarantined, createdIdentity)) fail(`setup quarantine identity mismatch: ${quarantine}`)
        console.error(`[safe-temp] setup scratch quarantined for manual reclamation: ${quarantine}`)
      } catch (cleanupError) {
        console.error(`[safe-temp] setup cleanup refused; recover scratch manually: ${scratch} (${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)})`)
      }
    }
    throw error
  }
}

function ownership(scratchArg, baseArg, rootArg, prefix, token, requirePresent = false) {
  assertPrefix(prefix)
  assertToken(token)
  const { base, root } = canonicalRoots(baseArg, rootArg)
  const scratchRequested = absolute(scratchArg, 'scratch')
  const scratchExists = fs.existsSync(scratchRequested)
  if (!scratchExists) {
    const missingCanonical = canonicalMaybeMissing(scratchRequested, 'scratch')
    assertScratchIdentity(missingCanonical, base, root, prefix)
    if (requirePresent) fail('scratch is missing')
    return { base, root, scratch: missingCanonical, requested: scratchRequested, record: null, present: false }
  }
  const stat = fs.lstatSync(scratchRequested)
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail('scratch must be the originally-owned real directory')
  const scratch = fs.realpathSync.native(scratchRequested)
  assertScratchIdentity(scratch, base, root, prefix)
  const markerRecord = readJsonFile(path.join(scratchRequested, MARKER_NAME), 'ownership marker')
  if (markerRecord?.version !== VERSION || typeof markerRecord?.base !== 'string' || typeof markerRecord?.root !== 'string' || typeof markerRecord?.scratch !== 'string' || typeof markerRecord?.prefix !== 'string' || !markerRecord.identity) fail('ownership marker has invalid fields')
  const identity = identityFor(scratch)
  if (!identity.supported) fail('stable scratch identity unavailable; refusing quarantine')
  assertRecord(markerRecord, { version: VERSION, base, root, scratch, token, prefix, identity })
  const receipt = readJsonFile(receiptPath(scratchRequested, token), 'ownership receipt')
  assertRecord(receipt, { version: VERSION, base, root, scratch, token, prefix, identity })
  return { base, root, scratch, requested: scratchRequested, record: receipt, identity, present: true }
}

function remove(scratchArg, baseArg, rootArg, prefix, token, pauseArg, pauseToken) {
  const owned = ownership(scratchArg, baseArg, rootArg, prefix, token)
  if (!owned.present) return
  if (pauseArg !== undefined || pauseToken !== undefined) pauseAfterValidation(owned.root, pauseArg, pauseToken, 'validated')
  let quarantine
  try {
    quarantine = quarantinePath(owned.base, prefix, token)
    fs.renameSync(owned.requested, quarantine)
  } catch (error) {
    if (!fs.existsSync(owned.requested)) return
    throw error
  }
  try {
    const stat = fs.lstatSync(quarantine)
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail('quarantine is not a real directory')
    const identity = identityFor(quarantine)
    if (!sameIdentity(identity, owned.identity)) fail(`quarantine identity mismatch: ${quarantine}`)
    const marker = readJsonFile(path.join(quarantine, MARKER_NAME), 'quarantine marker')
    assertRecord(marker, { ...owned.record, scratch: owned.record.scratch, identity: owned.identity })
    if (pauseArg !== undefined || pauseToken !== undefined) pauseAfterValidation(owned.root, pauseArg, pauseToken, 'boundary')
    process.stdout.write(`${JSON.stringify({ quarantine })}\n`)
  } catch (error) {
    let recovery = quarantine
    if (!fs.existsSync(owned.requested)) {
      try {
        fs.renameSync(quarantine, owned.requested)
        recovery = owned.requested
      } catch { /* leave quarantine for recovery */ }
    }
    throw new Error(`${error instanceof Error ? error.message : String(error)}; recovery path: ${recovery}`)
  }
}

function link(targetArg, linkArg, scratchArg, baseArg, rootArg, prefix, token) {
  const owned = ownership(scratchArg, baseArg, rootArg, prefix, token, true)
  const target = fs.realpathSync.native(absolute(targetArg, 'target'))
  const link = absolute(linkArg, 'link destination')
  if (fs.existsSync(link)) fail('link destination already exists')
  const parent = path.dirname(link)
  const parentCanonical = fs.realpathSync.native(parent)
  if (!withinOrEqual(parentCanonical, owned.scratch)) fail('link destination escapes owned scratch')
  fs.symlinkSync(target, link, 'junction')
}

async function launch(pidFile, logFile, command, args) {
  const pid = absolute(pidFile, 'pid file')
  const log = absolute(logFile, 'log file')
  const fd = fs.openSync(log, 'a')
  const batchCommand = process.platform === 'win32' &&
    (/(?:^|[\\/])[^\\/]+\.(?:cmd|bat)$/i.test(command) || /^(?:pnpm|npx|dsh)$/i.test(command))
    ? (/(?:\.(?:cmd|bat))$/i.test(command) ? command : `${command}.cmd`)
    : null
  // Node cannot execute .cmd/.bat files directly. A private one-shot batch
  // wrapper invokes the target through randomized environment variables. The
  // wrapper source contains only variable names: values are expanded with
  // delayed expansion after cmd has parsed operators, so untrusted arguments
  // never become batch source.
  const executable = command
  let childArgs = args
  const childEnv = { ...process.env }
  let wrapper
  if (batchCommand) {
    wrapper = path.join(path.dirname(log), `.dsh-launch-${crypto.randomBytes(16).toString('hex')}.cmd`)
    const envPrefix = `DSH_SAFE_TEMP_${crypto.randomBytes(16).toString('hex').toUpperCase()}`
    const targetName = `${envPrefix}_TARGET`
    const countName = `${envPrefix}_COUNT`
    const argsName = `${envPrefix}_ARG_`
    childEnv[targetName] = `"${batchCommand}"`
    childEnv[countName] = String(args.length)
    args.forEach((arg, index) => { childEnv[`${argsName}${index}`] = quoteWindowsArg(arg) })
    const invocationName = `${envPrefix}_INVOCATION`
    const lines = [
      '@echo off',
      'setlocal EnableDelayedExpansion',
      `set "${invocationName}=!${targetName}!"`,
      `for /l %%I in (0,1,!${countName}!-1) do set "${invocationName}=!${invocationName}! !${argsName}%%I!"`,
      `!${invocationName}!`,
    ]
    fs.writeFileSync(wrapper, `${lines.join('\r\n')}\r\n`, { flag: 'wx', mode: 0o600 })
    childArgs = ['/d', '/c', `""${wrapper}""`]
  }
  const child = spawn(batchCommand ? (process.env.ComSpec || 'cmd.exe') : executable, childArgs, {
    detached: process.platform !== 'win32',
    env: childEnv,
    stdio: ['ignore', fd, fd],
    windowsVerbatimArguments: Boolean(batchCommand),
  })
  fs.closeSync(fd)
  if (!child.pid) fail('failed to capture child pid')
  fs.writeFileSync(pid, `${child.pid}\n`, { flag: 'wx', mode: 0o600 })
  await new Promise((resolve) => {
    child.once('error', (error) => {
      try { fs.unlinkSync(pid) } catch { /* already gone */ }
      if (wrapper) try { fs.unlinkSync(wrapper) } catch { /* already gone */ }
      console.error(`[safe-temp] child failed: ${error.message}`)
      resolve()
      process.exitCode = 1
    })
    child.once('exit', (code, signal) => {
      try { fs.unlinkSync(pid) } catch { /* already gone */ }
      if (wrapper) try { fs.unlinkSync(wrapper) } catch { /* already gone */ }
      process.exitCode = code ?? (signal ? 1 : 0)
      resolve()
    })
  })
}

function quoteWindowsArg(value) {
  const text = String(value)
  if (/[\0\r\n]/.test(text)) fail('batch command arguments cannot contain NUL or newlines')
  return `"${text.replace(/\^/g, '^^').replace(/!/g, '^!').replace(/[&|<>]/g, '^$&').replace(/"/g, '"^"')}"`
}

function terminate(pidArg) {
  if (!/^\d+$/.test(pidArg || '') || Number(pidArg) <= 0) fail('invalid pid')
  const pid = Number(pidArg)
  try {
    if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })
    else {
      process.kill(-pid, 'SIGTERM')
      const deadline = Date.now() + 2_000
      while (Date.now() < deadline) {
        try { process.kill(-pid, 0) } catch (error) {
          if (error?.code === 'ESRCH') return
          throw error
        }
        const wait = new Int32Array(new SharedArrayBuffer(4))
        Atomics.wait(wait, 0, 0, 25)
      }
      try { process.kill(-pid, 'SIGKILL') } catch (error) {
        if (error?.code !== 'ESRCH') throw error
      }
    }
  } catch (error) {
    if (error?.code !== 'ESRCH' && process.platform !== 'win32') throw error
  }
}

function usage() {
  console.error(`usage: safe-temp.mjs
  create <base> <root> <prefix>
  remove <scratch> <base> <root> <prefix> <token>
  remove-test <scratch> <base> <root> <prefix> <token> <pause-dir> <pause-token>
  link <target> <link> <scratch> <base> <root> <prefix> <token>
  launch <pid-file> <log-file> <command> [args...]
  terminate <pid>`)
  process.exit(2)
}

const [command, ...args] = process.argv.slice(2)
try {
  if (command === 'create' && args.length === 3) create(...args)
  else if (command === 'remove' && args.length === 5) remove(...args)
  else if (command === 'remove-test' && args.length === 7) remove(...args)
  else if (command === 'link' && args.length === 7) link(...args)
  else if (command === 'launch' && args.length >= 3) await launch(args[0], args[1], args[2], args.slice(3))
  else if (command === 'terminate' && args.length === 1) terminate(args[0])
  else usage()
} catch (error) {
  console.error(`[safe-temp] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
