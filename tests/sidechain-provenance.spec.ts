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
  'src/client/sidechain/observer.tsx',
  'src/client/sidechain/TranscriptRows.tsx',
  'src/client/sidechain/transcript.ts',
  'src/sidechain-host/commands.ts',
  'src/sidechain-host/prompts.ts',
  'src/sidechain-host/settlement-silence.ts',
  'src/sidechain-host/side.ts',
] as const

const provenance = /adapted from @dsh-external\/dsh-sidechain[\s\S]*?Copyright \(c\) 2026, dsh-external contributors, under the BSD-3-Clause[\s\S]*?License\. See THIRD_PARTY_NOTICES for the complete notice\./

const completeBsdNotice = `## dsh-sidechain

BSD 3-Clause License

Copyright (c) 2026, dsh-external contributors

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its
   contributors may be used to endorse or promote products derived from
   this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.`

function normalizeNotice(notice: string): string {
  return notice
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.trimEnd())
    .join('\n')
    .trim()
}

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
    expect(normalizeNotice(notice)).toBe(normalizeNotice(completeBsdNotice))

    const files = packInventory()
    expect(files).toContain('README.md')
    expect(files).toContain('README_EN.md')
    expect(files).toContain('scripts/install.sh')
    expect(files).toContain('scripts/install.ps1')
    expect(files).toContain('THIRD_PARTY_NOTICES')
    expect(files.some(path => path.startsWith('.artifacts/'))).toBe(false)
  }, 120_000)
})
