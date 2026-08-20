#!/usr/bin/env node

/**
 * Small cross-platform helper for the verification scripts.  A scratch path
 * is only removed after all of its ownership guards pass.  In particular,
 * callers must provide a marker created by this process; a malformed path is
 * never passed to rmSync.
 */
import fs from 'node:fs'
import path from 'node:path'

const MARKER_TEXT = 'dsh-better-sidebar verification scratch\n'

function usage() {
  console.error('usage: safe-temp.mjs create <base> <root> <prefix> <marker> | remove <scratch> <base> <root> <prefix> <marker> | link <target> <link>')
  process.exit(2)
}

function resolved(value, label) {
  if (!value) throw new Error(`${label} is required`)
  return path.resolve(value)
}

function strictDescendant(child, parent) {
  const relative = path.relative(parent, child)
  return Boolean(relative) && !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`)
}

function create(baseArg, rootArg, prefix, markerName) {
  const base = resolved(baseArg, 'base')
  const root = resolved(rootArg, 'root')
  if (!prefix || !markerName || markerName.includes('/') || markerName.includes('\\')) throw new Error('invalid scratch prefix or marker')
  fs.mkdirSync(base, { recursive: true })
  if (!fs.statSync(base).isDirectory()) throw new Error(`scratch base is not a directory: ${base}`)
  const scratch = fs.mkdtempSync(path.join(base, prefix))
  // Never let a default temp path accidentally alias the repository itself.
  if (scratch === root) {
    fs.rmSync(scratch, { recursive: true, force: true })
    throw new Error('scratch path must differ from repository root')
  }
  fs.writeFileSync(path.join(scratch, markerName), MARKER_TEXT, { flag: 'wx' })
  process.stdout.write(scratch)
}

function remove(scratchArg, baseArg, rootArg, prefix, markerName) {
  const scratch = resolved(scratchArg, 'scratch')
  const base = resolved(baseArg, 'base')
  const root = resolved(rootArg, 'root')
  const marker = path.join(scratch, markerName || '')
  const valid = strictDescendant(scratch, base)
    && scratch !== root
    && path.basename(scratch).startsWith(prefix || '')
    && Boolean(prefix)
    && Boolean(markerName)
  if (!valid) throw new Error(`refusing to remove unowned scratch path: ${scratch}`)
  const scratchStat = fs.lstatSync(scratch)
  if (!scratchStat.isDirectory() || scratchStat.isSymbolicLink()) throw new Error(`scratch is not a real directory: ${scratch}`)
  const markerStat = fs.lstatSync(marker)
  if (!markerStat.isFile() || markerStat.isSymbolicLink() || fs.readFileSync(marker, 'utf8') !== MARKER_TEXT) {
    throw new Error(`scratch ownership marker is missing or invalid: ${marker}`)
  }
  fs.rmSync(scratch, { recursive: true, force: true })
}

function link(targetArg, linkArg) {
  const target = resolved(targetArg, 'target')
  const linkPath = resolved(linkArg, 'link')
  fs.symlinkSync(target, linkPath, 'junction')
}

const [command, ...args] = process.argv.slice(2)
try {
  if (command === 'create' && args.length === 4) create(...args)
  else if (command === 'remove' && args.length === 5) remove(...args)
  else if (command === 'link' && args.length === 2) link(...args)
  else usage()
} catch (error) {
  console.error(`[safe-temp] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
