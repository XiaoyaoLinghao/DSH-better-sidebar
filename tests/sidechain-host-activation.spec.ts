import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/index.ts'
import * as sidechainHost from '../src/sidechain-host/index.ts'
import { registerSidechainHost, sidechainRegistryPath } from '../src/sidechain-host/index.ts'

interface Harness {
  ctx: {
    inject: ReturnType<typeof vi.fn>
    effect: ReturnType<typeof vi.fn>
  }
  cleanups: Array<() => void>
  commandDisposers: Array<ReturnType<typeof vi.fn>>
  registered: unknown[]
  subagents: {
    start: ReturnType<typeof vi.fn>
  }
}

interface AdmissionAgent {
  id: string
  followup: (...args: unknown[]) => unknown
  steer: (...args: unknown[]) => unknown
  inject: (...args: unknown[]) => unknown
}

function makeHarness(options: {
  commands?: boolean
  subagents?: boolean
  liveAgents?: AdmissionAgent[]
  listenerDisposer?: ReturnType<typeof vi.fn>
} = {}): Harness {
  const cleanups: Array<() => void> = []
  const registered: unknown[] = []
  const commandDisposers: Array<ReturnType<typeof vi.fn>> = []
  const listenerDisposer = options.listenerDisposer ?? vi.fn()
  const agents = {
    list: () => options.liveAgents ?? [],
    on: vi.fn(() => listenerDisposer),
  }
  const subagents = {
    start: vi.fn(),
    startContinuable: vi.fn(),
    listChildren: vi.fn(),
    getProvider: vi.fn(() => ({ name: 'fork' })),
  }
  const commands = {
    register: vi.fn((definition: unknown) => {
      registered.push(definition)
      const dispose = vi.fn()
      commandDisposers.push(dispose)
      return dispose
    }),
  }
  const effect = vi.fn((fn: () => void | (() => void)) => {
    const cleanup = fn()
    if (typeof cleanup === 'function') cleanups.push(cleanup)
  })
  const inject = vi.fn((deps: string[], callback: (ctx: any) => void) => {
    if (deps.includes('agents') && deps.includes('subagents')) {
      if (options.subagents === false) return
      callback({ agents, subagents, inject, effect, on: vi.fn(() => listenerDisposer), logger: { warn: vi.fn(), error: vi.fn() } })
      return
    }
    if (deps.includes('commands')) {
      if (options.commands === false) return
      callback({ agents, subagents, commands, inject, effect, on: vi.fn(() => listenerDisposer), logger: { warn: vi.fn(), error: vi.fn() } })
    }
  })
  return { ctx: { inject, effect }, cleanups, commandDisposers, registered, subagents }
}

function makeApplyContext() {
  const effects: Array<() => void> = []
  return {
    webRuntime: { trustedHosts: [] },
    webServer: {
      register: () => () => {},
      registerUpgrade: () => () => {},
    },
    sessions: { get: () => undefined },
    tools: { register: () => () => {} },
    effect: (fn: () => void | (() => void)) => {
      const cleanup = fn()
      if (typeof cleanup === 'function') effects.push(cleanup)
    },
    inject: () => () => {},
    get: () => undefined,
    effects,
  }
}

function makeAdmissionAgent(): { agent: AdmissionAgent; originals: Record<'followup' | 'steer' | 'inject', AdmissionAgent['followup']> } {
  const originals = {
    followup: vi.fn(),
    steer: vi.fn(),
    inject: vi.fn(),
  }
  return { agent: { id: 'parent', ...originals }, originals }
}

describe('sidechain host activation', () => {
  it('wires activation exactly once from apply with the resolved sidechain config', () => {
    const activation = vi.spyOn(sidechainHost, 'registerSidechainHost')
    const ctx = makeApplyContext()
    apply(ctx as never, {
      sidechain: {
        providerName: 'custom-provider',
        persona: 'custom-persona',
        readOnlyTools: ['fs.read'],
      },
    })

    expect(activation).toHaveBeenCalledTimes(1)
    expect(activation).toHaveBeenCalledWith(ctx, {
      providerName: 'custom-provider',
      persona: 'custom-persona',
      readOnlyTools: ['fs.read'],
    })
    for (const cleanup of ctx.effects) cleanup()
    activation.mockRestore()
  })

  it('registers both commands and applies an exact read-only restriction', async () => {
    const harness = makeHarness()
    registerSidechainHost(harness.ctx as never, {
      providerName: 'fork',
      persona: 'persona',
      readOnlyTools: ['fs.read', 'git.status'],
    })

    expect(harness.registered).toHaveLength(2)
    harness.subagents.start.mockResolvedValue({
      id: 'child',
      result: new Promise(() => {}),
      dispose: vi.fn(),
    })
    const btw = harness.registered[1] as { handler: (input: unknown) => Promise<unknown> }
    await btw.handler({
      agent: { session: { id: 'parent' } },
      rawInput: 'question',
      signal: new AbortController().signal,
      attachments: [],
    })
    expect(harness.subagents.start).toHaveBeenCalledWith('fork', expect.objectContaining({
      toolFilter: { allow: ['fs.read', 'git.status'] },
    }))
  })

  it('keeps the parent feature harmless when optional services are absent', () => {
    expect(() => registerSidechainHost(makeHarness({ subagents: false }).ctx as never, {
      providerName: 'fork',
      persona: 'persona',
    })).not.toThrow()
    expect(() => registerSidechainHost(makeHarness({ commands: false }).ctx as never, {
      providerName: 'fork',
      persona: 'persona',
    })).not.toThrow()
  })

  it('omits the restriction entirely when readOnlyTools is not configured', async () => {
    const harness = makeHarness()
    registerSidechainHost(harness.ctx as never, { providerName: 'fork', persona: 'persona' })
    harness.subagents.start.mockResolvedValue({
      id: 'child',
      result: new Promise(() => {}),
      dispose: vi.fn(),
    })
    const btw = harness.registered[1] as { handler: (input: unknown) => Promise<unknown> }
    await btw.handler({
      agent: { session: { id: 'parent' } },
      rawInput: 'question',
      signal: new AbortController().signal,
      attachments: [],
    })
    expect(harness.subagents.start).toHaveBeenCalledWith('fork', expect.not.objectContaining({ toolFilter: expect.anything() }))
  })

  it.each([
    ['explicit', 'D:/custom-dsh', join('D:/custom-dsh', 'sidechain-children.json')],
    ['blank', '   ', join(homedir(), '.dsh', 'sidechain-children.json')],
    ['empty', '', join(homedir(), '.dsh', 'sidechain-children.json')],
  ])('uses the %s DSH_HOME registry location', (_name, value, expected) => {
    vi.stubEnv('DSH_HOME', value)
    const harness = makeHarness({ commands: false })
    registerSidechainHost(harness.ctx as never, { providerName: 'fork', persona: 'persona' })
    expect(harness.cleanups).toHaveLength(1)
    expect(sidechainRegistryPath()).toBe(expected)
    vi.unstubAllEnvs()
  })

  it('falls back to the user .dsh directory when DSH_HOME is unset', () => {
    const previous = process.env.DSH_HOME
    delete process.env.DSH_HOME
    try {
      expect(sidechainRegistryPath()).toBe(join(homedir(), '.dsh', 'sidechain-children.json'))
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
    }
  })

  it('owns command and isolation cleanup by Cordis effects', () => {
    const { agent, originals } = makeAdmissionAgent()
    const listenerDisposer = vi.fn()
    const harness = makeHarness({ liveAgents: [agent], listenerDisposer })
    registerSidechainHost(harness.ctx as never, { providerName: 'fork', persona: 'persona' })
    expect(harness.commandDisposers).toHaveLength(2)
    expect(agent.followup).not.toBe(originals.followup)
    expect(agent.steer).not.toBe(originals.steer)
    expect(agent.inject).not.toBe(originals.inject)
    for (const cleanup of harness.cleanups) cleanup()
    expect(harness.commandDisposers.every(dispose => dispose.mock.calls.length === 1)).toBe(true)
    expect(listenerDisposer).toHaveBeenCalledTimes(1)
    expect(agent.followup).toBe(originals.followup)
    expect(agent.steer).toBe(originals.steer)
    expect(agent.inject).toBe(originals.inject)
  })
})
