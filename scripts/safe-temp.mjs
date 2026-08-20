#!/usr/bin/env node

import crypto from 'node:crypto'
import fs from 'node:fs'
import { execFileSync, spawn } from 'node:child_process'
import path from 'node:path'

const VERSION = 1
const MARKER_NAME = '.dsh-verification-owner.json'
const RECEIPT_DIR = '.dsh-verification-receipts'
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

function receiptPath(base, token) {
  assertToken(token)
  const directory = path.join(base, RECEIPT_DIR)
  let stat
  try { stat = fs.lstatSync(directory) } catch { fail('ownership receipt directory is missing') }
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail('ownership receipt directory must not be a symlink')
  return path.join(directory, `${crypto.createHash('sha256').update(token).digest('hex')}.json`)
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
  let receipt
  try {
    scratch = fs.realpathSync.native(fs.mkdtempSync(path.join(base, prefix)))
    assertScratchIdentity(scratch, base, root, prefix)
    const token = crypto.randomBytes(32).toString('hex')
    const record = { version: VERSION, base, root, scratch, token, prefix }
    const receipts = path.join(base, RECEIPT_DIR)
    fs.mkdirSync(receipts, { recursive: true, mode: 0o700 })
    if (fs.lstatSync(receipts).isSymbolicLink()) fail('ownership receipt directory must not be a symlink')
    receipt = receiptPath(base, token)
    writeExclusive(receipt, record, 0o600)
    writeExclusive(path.join(scratch, MARKER_NAME), record, 0o600)
    process.stdout.write(`${JSON.stringify({ version: VERSION, scratch, token })}\n`)
  } catch (error) {
    if (receipt) {
      try { fs.rmSync(receipt, { force: true }) } catch { /* preserve original failure */ }
    }
    if (scratch) {
      try { fs.rmSync(scratch, { recursive: true, force: true }) } catch { /* preserve original failure */ }
    }
    throw error
  }
}

function ownership(scratchArg, baseArg, rootArg, prefix, token, requirePresent = false) {
  assertPrefix(prefix)
  assertToken(token)
  const { base, root } = canonicalRoots(baseArg, rootArg)
  const scratchRequested = absolute(scratchArg, 'scratch')
  const receipt = receiptPath(base, token)
  const record = readJsonFile(receipt, 'ownership receipt')
  if (record?.version !== VERSION || typeof record?.base !== 'string' || typeof record?.root !== 'string' || typeof record?.scratch !== 'string' || typeof record?.prefix !== 'string') fail('ownership receipt has invalid fields')
  assertRecord(record, { version: VERSION, base, root, scratch: record?.scratch, token, prefix })
  const scratchExists = fs.existsSync(scratchRequested)
  if (scratchExists) {
    const stat = fs.lstatSync(scratchRequested)
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail('scratch must be the originally-owned real directory')
    const scratch = fs.realpathSync.native(scratchRequested)
    assertRecord(record, { version: VERSION, base, root, scratch, token, prefix })
    assertScratchIdentity(scratch, base, root, prefix)
    const marker = path.join(scratchRequested, MARKER_NAME)
    const markerRecord = readJsonFile(marker, 'ownership marker')
    assertRecord(markerRecord, record)
    return { base, root, scratch, requested: scratchRequested, record, present: true }
  }
  const missingCanonical = canonicalMaybeMissing(scratchRequested, 'scratch')
  if (missingCanonical !== record.scratch) fail('missing scratch does not match ownership receipt')
  if (requirePresent) fail('scratch is missing')
  return { base, root, scratch: record.scratch, requested: scratchRequested, record, present: false }
}

function remove(scratchArg, baseArg, rootArg, prefix, token) {
  const owned = ownership(scratchArg, baseArg, rootArg, prefix, token)
  if (owned.present) fs.rmSync(owned.requested, { recursive: true, force: true })
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
  const executable = process.platform === 'win32' && (command === 'npx' || command === 'dsh') ? `${command}.cmd` : command
  const child = spawn(executable, args, {
    detached: process.platform !== 'win32',
    env: process.env,
    stdio: ['ignore', fd, fd],
  })
  fs.closeSync(fd)
  if (!child.pid) fail('failed to capture child pid')
  fs.writeFileSync(pid, `${child.pid}\n`, { flag: 'wx', mode: 0o600 })
  await new Promise((resolve) => {
    child.once('error', (error) => {
      try { fs.unlinkSync(pid) } catch { /* already gone */ }
      console.error(`[safe-temp] child failed: ${error.message}`)
      resolve()
      process.exitCode = 1
    })
    child.once('exit', (code, signal) => {
      try { fs.unlinkSync(pid) } catch { /* already gone */ }
      process.exitCode = code ?? (signal ? 1 : 0)
      resolve()
    })
  })
}

function terminate(pidArg) {
  if (!/^\d+$/.test(pidArg || '') || Number(pidArg) <= 0) fail('invalid pid')
  const pid = Number(pidArg)
  try {
    if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })
    else process.kill(-pid, 'SIGTERM')
  } catch (error) {
    if (error?.code !== 'ESRCH' && process.platform !== 'win32') throw error
  }
}

function usage() {
  console.error(`usage: safe-temp.mjs
  create <base> <root> <prefix>
  remove <scratch> <base> <root> <prefix> <token>
  link <target> <link> <scratch> <base> <root> <prefix> <token>
  launch <pid-file> <log-file> <command> [args...]
  terminate <pid>`)
  process.exit(2)
}

const [command, ...args] = process.argv.slice(2)
try {
  if (command === 'create' && args.length === 3) create(...args)
  else if (command === 'remove' && args.length === 5) remove(...args)
  else if (command === 'link' && args.length === 7) link(...args)
  else if (command === 'launch' && args.length >= 3) await launch(args[0], args[1], args[2], args.slice(3))
  else if (command === 'terminate' && args.length === 1) terminate(args[0])
  else usage()
} catch (error) {
  console.error(`[safe-temp] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
