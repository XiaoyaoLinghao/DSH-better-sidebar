import { describe, expect, it, vi } from 'vitest'
import { createSettlementSilenceRuntime } from '../src/sidechain-host/settlement-silence.ts'

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
  emitCreated: (agent: TestAgent) => void
}

function source(kind: string, senderSessionId: string): Record<string, unknown> {
  return {
    kind,
    form: kind === 'subagent-report' ? 'relay' : 'notice',
    ...(kind === 'subagent-report' ? { senderSessionId } : { summary: 'done', senderSessionId }),
  }
}

function makeAgent(id: string): { agent: TestAgent; originals: Record<Admission, ReturnType<typeof vi.fn>> } {
  const originals = {
    followup: vi.fn(),
    steer: vi.fn(),
    inject: vi.fn(),
  }
  const agent = { id, ...originals } as TestAgent
  return { agent, originals }
}

function makeContext(live: TestAgent[] = []): TestContext {
  let created: ((payload: { agent: TestAgent }) => void) | undefined
  return {
    agents: { list: () => live },
    on: vi.fn((name: string, listener: (payload: { agent: TestAgent }) => void) => {
      expect(name).toBe('agent/created')
      created = listener
      return vi.fn()
    }),
    emitCreated: (agent) => created?.({ agent }),
  }
}

describe('settlement silence runtime', () => {
  it.each(['followup', 'steer', 'inject'] as Admission[])('suppresses exact recorded child settlement/report on %s', (method) => {
    const { agent, originals } = makeAgent('parent')
    const ctx = makeContext([agent])
    const runtime = createSettlementSilenceRuntime(ctx as never)
    runtime.noteChild('side-1')

    agent[method]({ role: 'user', content: [], source: source('subagent-settled', 'side-1') })
    agent[method]({ role: 'user', content: [], source: source('subagent-report', 'side-1') })

    expect(originals[method]).not.toHaveBeenCalled()
  })

  it.each(['followup', 'steer', 'inject'] as Admission[])('passes unrelated and unrecorded source forms through %s', (method) => {
    const { agent, originals } = makeAgent('parent')
    const ctx = makeContext([agent])
    const runtime = createSettlementSilenceRuntime(ctx as never)
    runtime.noteChild('side-1')

    const messages = [
      { role: 'user', content: [], source: source('subagent-settled', 'other-child') },
      { role: 'user', content: [], source: source('subagent-report', 'other-child') },
      { role: 'user', content: [], source: { kind: 'ordinary', senderSessionId: 'side-1' } },
    ]
    for (const message of messages) agent[method](message)

    expect(originals[method]).toHaveBeenCalledTimes(messages.length)
    expect(originals[method]).toHaveBeenNthCalledWith(1, messages[0])
    expect(originals[method]).toHaveBeenNthCalledWith(2, messages[1])
    expect(originals[method]).toHaveBeenNthCalledWith(3, messages[2])
  })

  it.each(['followup', 'steer', 'inject'] as Admission[])('passes recorded-child sources with wrong or missing required fields through %s', (method) => {
    const { agent, originals } = makeAgent('parent')
    const ctx = makeContext([agent])
    const runtime = createSettlementSilenceRuntime(ctx as never)
    runtime.noteChild('side-1')

    const messages = [
      { role: 'user', content: [], source: { kind: 'subagent-report', form: 'notice', senderSessionId: 'side-1' } },
      { role: 'user', content: [], source: { kind: 'subagent-report', senderSessionId: 'side-1' } },
      { role: 'user', content: [], source: { kind: 'subagent-settled', form: 'relay', summary: 'done', senderSessionId: 'side-1' } },
      { role: 'user', content: [], source: { kind: 'subagent-settled', form: 'notice', senderSessionId: 'side-1' } },
      { role: 'user', content: [], source: { kind: 'subagent-settled', form: 'notice', summary: 42, senderSessionId: 'side-1' } },
      { role: 'user', content: [], source: { kind: 'subagent-settled', form: 'notice', summary: 'done' } },
    ]
    for (const message of messages) agent[method](message)

    expect(originals[method]).toHaveBeenCalledTimes(messages.length)
  })

  it('wraps agents created after runtime setup and restores exact descriptors on dispose', () => {
    const { agent, originals } = makeAgent('live')
    const descriptors = Object.fromEntries(
      (['followup', 'steer', 'inject'] as Admission[]).map((method) => [method, Object.getOwnPropertyDescriptor(agent, method)]),
    )
    const ctx = makeContext([agent])
    const runtime = createSettlementSilenceRuntime(ctx as never)
    const future = makeAgent('future')
    const futureDescriptors = Object.fromEntries(
      (['followup', 'steer', 'inject'] as Admission[]).map((method) => [method, Object.getOwnPropertyDescriptor(future.agent, method)]),
    )
    ctx.emitCreated(future.agent)
    runtime.noteChild('future')

    for (const method of ['followup', 'steer', 'inject'] as Admission[]) {
      future.agent[method]({ role: 'user', content: [], source: source('subagent-settled', 'future') })
      expect(future.originals[method]).not.toHaveBeenCalled()
    }

    runtime.dispose()
    for (const method of ['followup', 'steer', 'inject'] as Admission[]) {
      expect(Object.getOwnPropertyDescriptor(agent, method)).toEqual(descriptors[method])
      expect(Object.getOwnPropertyDescriptor(future.agent, method)).toEqual(
        futureDescriptors[method],
      )
    }
    agent.followup({ role: 'user', content: [], source: source('subagent-settled', 'side-1') })
    expect(originals.followup).toHaveBeenCalledTimes(1)
  })
})
