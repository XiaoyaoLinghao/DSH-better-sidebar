import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  createSettlementSilence,
  createSettlementSilenceForTest,
  type SettlementRegistryFileSystem,
} from '../src/sidechain-host/settlement-silence.ts'

type Admission = 'followup' | 'steer' | 'inject'

interface TestAgent {
  id: string
  followup: (message: unknown) => void
  steer: (message: unknown) => void
  inject: (message: unknown) => void
}

interface TestContext {
  agents: { list: () => TestAgent[] }
  on: (name: string, listener: (payload: { agent: TestAgent }) => void) => () => void
  logger: { error: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> }
}

function makeAgent(id: string): { agent: TestAgent; originals: Record<Admission, ReturnType<typeof vi.fn>> } {
  const followup = vi.fn()
  const originals = { followup, steer: vi.fn(), inject: vi.fn() }
  return { agent: { id, ...originals }, originals }
}

function makeContext(live: TestAgent[] = []): TestContext {
  return {
    agents: { list: () => live },
    on: vi.fn(() => vi.fn()),
    logger: { error: vi.fn(), warn: vi.fn() },
  }
}

function settledMessage(childId: string): Record<string, unknown> {
  return {
    source: { kind: 'subagent-settled', form: 'notice', summary: 'done', senderSessionId: childId },
  }
}

function fakeFs(overrides: Partial<SettlementRegistryFileSystem> = {}): SettlementRegistryFileSystem & {
  calls: Array<[string, ...string[]]>
} {
  const calls: Array<[string, ...string[]]> = []
  return {
    calls,
    readFileSync: vi.fn(() => {
      throw Object.assign(new Error('missing'), { code: 'ENOENT' })
    }),
    writeFileSync: vi.fn((path: string, data: string) => {
      calls.push(['write', path, data])
    }),
    renameSync: vi.fn((from: string, to: string) => {
      calls.push(['rename', from, to])
    }),
    unlinkSync: vi.fn((path: string) => {
      calls.push(['unlink', path])
    }),
    ...overrides,
  }
}

describe('persistent settlement silence registry', () => {
  it('persists before noteChild returns and restores suppression after restart', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-settlement-registry-'))
    const registryPath = join(root, 'settlements.json')
    try {
      const first = makeContext()
      const runtime = createSettlementSilence(first as never, { registryPath })
      runtime.noteChild('side-1')

      expect(JSON.parse(readFileSync(registryPath, 'utf8'))).toEqual(['side-1'])
      runtime.dispose()

      const { agent, originals } = makeAgent('parent')
      const restarted = createSettlementSilence(makeContext([agent]) as never, { registryPath })
      agent.followup(settledMessage('side-1'))
      expect(originals.followup).not.toHaveBeenCalled()
      restarted.dispose()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it.each([
    ['missing registry', undefined],
    ['malformed JSON', '{not-json'],
    ['non-array JSON', JSON.stringify({ children: ['side-1'] })],
  ])('recovers from %s without disabling the runtime', (_name, contents) => {
    const fs = fakeFs(contents === undefined ? {} : {
      readFileSync: vi.fn(() => contents),
    })
    const { agent, originals } = makeAgent('parent')
    const runtime = createSettlementSilenceForTest(makeContext([agent]) as never, { registryPath: 'registry.json' }, fs)

    runtime.noteChild('side-1')
    agent.followup(settledMessage('side-1'))
    expect(originals.followup).not.toHaveBeenCalled()
    runtime.dispose()
  })

  it('rewrites a sibling temp file and renames it for each newly admitted child', () => {
    const fs = fakeFs()
    const runtime = createSettlementSilenceForTest(makeContext() as never, { registryPath: 'state/children.json' }, fs)
    const tempPath = `state/children.json.dsh-sidebar-tmp-${process.pid}`

    runtime.noteChild('side-1')
    runtime.noteChild('side-2')

    expect(fs.writeFileSync).toHaveBeenNthCalledWith(1, tempPath, '["side-1"]', 'utf8')
    expect(fs.renameSync).toHaveBeenNthCalledWith(1, tempPath, 'state/children.json')
    expect(fs.writeFileSync).toHaveBeenNthCalledWith(2, tempPath, '["side-1","side-2"]', 'utf8')
    expect(fs.renameSync).toHaveBeenNthCalledWith(2, tempPath, 'state/children.json')
    runtime.dispose()
  })

  it('records in memory first and keeps suppression when persistence fails', () => {
    const error = new Error('disk full')
    const fs = fakeFs({
      writeFileSync: vi.fn(() => { throw error }),
    })
    const ctx = makeContext()
    const { agent, originals } = makeAgent('parent')
    const runtime = createSettlementSilenceForTest({ ...ctx, agents: { list: () => [agent] } } as never, { registryPath: 'registry.json' }, fs)

    expect(() => runtime.noteChild('side-1')).not.toThrow()
    agent.followup(settledMessage('side-1'))

    expect(originals.followup).not.toHaveBeenCalled()
    expect(ctx.logger.error).toHaveBeenCalledWith(expect.stringContaining('settlement registry'), error)
    expect(fs.unlinkSync).toHaveBeenCalledWith(`registry.json.dsh-sidebar-tmp-${process.pid}`)
    runtime.dispose()
  })

  it('best-effort temp cleanup never turns a failed rename into a command error', () => {
    const fs = fakeFs({
      renameSync: vi.fn(() => { throw new Error('rename failed') }),
      unlinkSync: vi.fn(() => { throw new Error('cleanup failed') }),
    })
    const runtime = createSettlementSilenceForTest(makeContext() as never, { registryPath: 'registry.json' }, fs)

    expect(() => runtime.noteChild('side-1')).not.toThrow()
    expect(fs.unlinkSync).toHaveBeenCalledWith(`registry.json.dsh-sidebar-tmp-${process.pid}`)
    runtime.dispose()
  })

  it.each(['followup', 'steer', 'inject'] as Admission[])('uses restored IDs for %s admission', (method: Admission) => {
    const fs = fakeFs({ readFileSync: vi.fn(() => '["side-1"]') })
    const { agent, originals } = makeAgent('parent')
    const runtime = createSettlementSilenceForTest(makeContext([agent]) as never, { registryPath: 'registry.json' }, fs)

    agent[method](settledMessage('side-1'))
    expect(originals[method]).not.toHaveBeenCalled()
    runtime.dispose()
  })
})
