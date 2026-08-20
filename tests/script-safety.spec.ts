import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const helper = resolve(process.cwd(), 'scripts/safe-temp.mjs')
const marker = '.script-safety.marker'
const markerText = 'dsh-better-sidebar verification scratch\n'

describe('verification script scratch safety', () => {
  it('creates and removes only a marked, prefixed descendant', () => {
    const base = mkdtempSync(join(tmpdir(), 'dsh-script-safety-base.'))
    try {
      const scratch = execFileSync(process.execPath, [helper, 'create', base, process.cwd(), 'dsh-script-safety.', marker], { encoding: 'utf8' })
      expect(readFileSync(join(scratch, marker), 'utf8')).toBe(markerText)
      execFileSync(process.execPath, [helper, 'remove', scratch, base, process.cwd(), 'dsh-script-safety.', marker])
      expect(existsSync(scratch)).toBe(false)
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })

  it('refuses an unowned path without deleting it', () => {
    const base = mkdtempSync(join(tmpdir(), 'dsh-script-safety-base.'))
    const sibling = mkdtempSync(join(base, 'other-prefix.'))
    writeFileSync(join(sibling, marker), markerText)
    try {
      const result = spawnSync(process.execPath, [helper, 'remove', sibling, base, process.cwd(), 'dsh-script-safety.', marker], { encoding: 'utf8' })
      expect(result.status).not.toBe(0)
      expect(existsSync(sibling)).toBe(true)
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })
})
