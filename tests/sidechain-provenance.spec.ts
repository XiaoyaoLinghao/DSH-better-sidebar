import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')

// These modules contain the behavior adapted from dsh-sidechain. Keep the
// inventory explicit so a future adaptation cannot silently lose attribution.
const adaptedSources = [
  'src/client/sidechain/activity.ts',
  'src/client/sidechain/file-mentions.ts',
  'src/client/sidechain/history.ts',
  'src/client/sidechain/TranscriptRows.tsx',
  'src/sidechain-host/commands.ts',
  'src/sidechain-host/prompts.ts',
  'src/sidechain-host/settlement-silence.ts',
  'src/sidechain-host/side.ts',
] as const

const provenance = /adapted from @dsh-external\/dsh-sidechain[\s\S]*BSD-3-Clause/

function read(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), 'utf8')
}

function packInventory(): string[] {
  // The Windows pnpm shim is a PowerShell script in the desktop runtime and
  // cannot be spawned directly by Node's execFileSync (EINVAL). Execute it
  // through cmd.exe while retaining a direct spawn on POSIX runners.
  const executable = process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : 'pnpm'
  const args = process.platform === 'win32'
    ? ['/d', '/s', '/c', 'pnpm pack --dry-run --json']
    : ['pack', '--dry-run', '--json']
  const output = execFileSync(executable, args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  const start = output.indexOf('{')
  expect(start, 'pnpm pack --dry-run --json must emit a JSON manifest').toBeGreaterThanOrEqual(0)
  const manifest = JSON.parse(output.slice(start)) as { files?: Array<{ path?: string }> }
  return (manifest.files ?? []).flatMap(file => file.path === undefined ? [] : [file.path])
}

describe('sidechain package provenance', () => {
  it('keeps BSD provenance comments on every adapted source module', () => {
    for (const relativePath of adaptedSources) {
      expect(read(relativePath), relativePath).toMatch(provenance)
    }
  })

  it('ships the complete BSD-3-Clause notice and packs it', () => {
    const notice = read('THIRD_PARTY_NOTICES')
    expect(notice).toContain('BSD 3-Clause License')
    expect(notice).toContain('Copyright (c) 2026, dsh-external contributors')
    expect(notice).toContain('1. Redistributions of source code must retain')
    expect(notice).toContain('2. Redistributions in binary form must reproduce')
    expect(notice).toContain('3. Neither the name of the copyright holder')
    expect(notice).toContain('THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"')
    expect(notice).toContain('IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE')

    expect(packInventory()).toContain('THIRD_PARTY_NOTICES')
  }, 120_000)
})
