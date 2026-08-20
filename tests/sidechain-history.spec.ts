import { describe, expect, it, vi } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { SidebarSubagentAddress } from '../src/context-types.ts'
import { createSidechainHistory } from '../src/client/sidechain/history.ts'
import type { SidechainContinuableAddress } from '../src/client/sidechain/history.ts'

const ADDRESS: SidebarSubagentAddress = {
  parentSessionId: 'parent', childSessionId: 'child', mode: 'one-shot',
}
const CONTINUABLE: SidechainContinuableAddress = { ...ADDRESS, mode: 'continuable' }

function event(type: SessionEvent['type'], seq: number, data: Record<string, unknown>): SessionEvent {
  return { type, seq, time: 0, data } as SessionEvent
}

function page(events: Array<{ event: SessionEvent; view?: unknown }>, hasMore = false) {
  return { result: { ok: true, value: { events, hasMore } } }
}

function user(seq: number, text: string) {
  return { event: event('user/message', seq, { content: [{ type: 'text', text }] }) }
}

describe('createSidechainHistory', () => {
  it('paginates the tail backwards until the inherited seed boundary', async () => {
    const history = vi.fn()
      .mockResolvedValueOnce(page([user(90, 'new')], true))
      .mockResolvedValueOnce(page([
        { event: event('session/end-seed', 80, {}) },
        user(81, 'Side conversation boundary'),
      ]))
    const reader = createSidechainHistory({ history, prompt: vi.fn() } as never)

    const snapshot = await reader.fetchTranscript(ADDRESS)

    expect(history).toHaveBeenNthCalledWith(1, {
      parentSessionId: 'parent', childSessionId: 'child', mode: 'one-shot', maxMessages: 8,
    })
    expect(history).toHaveBeenNthCalledWith(2, {
      parentSessionId: 'parent', childSessionId: 'child', mode: 'one-shot', maxMessages: 8,
      beforeSeq: 90,
    })
    expect(snapshot.rows).toEqual([{ kind: 'user', seq: 90, text: 'new' }])
    expect(snapshot.streaming).toBe(false)
    expect(snapshot.hasMore).toBe(true)
  })

  it('merges each child tail by event sequence and carries produced paths forward', async () => {
    const history = vi.fn()
      .mockResolvedValueOnce(page([
        { event: event('session/end-seed', 1, {}) },
        { event: event('tool/call', 2, { callId: 'c1', name: 'edit', arguments: '{}' }), view: { for: 'call', view: { card: 'diff', title: 'x', diffs: [], locations: [{ path: 'a.ts' }] } } },
      ]))
      .mockResolvedValueOnce(page([
        { event: event('tool/result', 3, { message: { content: [{ type: 'tool-result', toolCallId: 'c1', content: [] }] } }) },
        user(4, 'done'),
      ]))
    const reader = createSidechainHistory({ history, prompt: vi.fn() } as never)

    const first = await reader.fetchTranscript(ADDRESS)
    const second = await reader.fetchTranscript(ADDRESS)

    expect(first.produced).toEqual(['a.ts'])
    expect(second.rows.map(row => row.seq)).toEqual([2, 4])
    expect(second.produced).toEqual(['a.ts'])
  })

  it('reports an unfinished assistant stream and forwards an optional history signal', async () => {
    const history = vi.fn().mockResolvedValue(page([
      { event: event('session/end-seed', 1, {}) },
      { event: event('assistant/chunk', 2, { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'partial' } }) },
    ]))
    const reader = createSidechainHistory({ history, prompt: vi.fn() } as never)
    const signal = new AbortController().signal

    const snapshot = await reader.fetchTranscript(ADDRESS, signal)

    expect(history).toHaveBeenCalledWith(expect.any(Object), signal)
    expect(snapshot.streaming).toBe(true)
  })

  it('contains business and transport failures without throwing', async () => {
    const history = vi.fn()
      .mockResolvedValueOnce({ result: { ok: false, error: { code: 'offline', message: 'offline' } } })
      .mockRejectedValueOnce(new Error('network'))
    const reader = createSidechainHistory({ history, prompt: vi.fn() } as never)

    expect((await reader.fetchTranscript(ADDRESS)).rows).toEqual([])
    expect(await reader.fetchActivity(ADDRESS)).toBeNull()
  })

  it('caps activity pagination while still deriving the latest activity', async () => {
    let pageIndex = 0
    const history = vi.fn().mockImplementation((payload: { beforeSeq?: number }) => {
      const first = payload.beforeSeq === undefined
      pageIndex++
      return Promise.resolve(page(first
        ? [{ event: event('assistant/chunk', 100, { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'tail' } }) }]
        : [{ event: event('user/message', 100 - pageIndex * 10, { content: [{ type: 'text', text: 'old' }] }) }], true))
    })
    const reader = createSidechainHistory({ history, prompt: vi.fn() } as never)

    expect(await reader.fetchActivity(ADDRESS)).toBe('tail')
    expect(history).toHaveBeenCalledTimes(4)
  })

  it('uses the continuable address and forwards the required prompt signal', async () => {
    const prompt = vi.fn().mockResolvedValue({ result: { ok: true, value: { messageId: 'm1' } } })
    const reader = createSidechainHistory({ history: vi.fn(), prompt } as never)
    const signal = new AbortController().signal

    expect(await reader.sendPrompt(CONTINUABLE, '继续', signal)).toBe(true)
    expect(prompt).toHaveBeenCalledWith({
      ...CONTINUABLE, content: [{ type: 'text', text: '继续' }],
    }, signal)
  })

  it('resets all caches when disposed, keeping instances activation-scoped', async () => {
    const history = vi.fn()
      .mockResolvedValueOnce(page([{ event: event('session/end-seed', 1, {}) }, user(2, 'first')]))
      .mockResolvedValueOnce(page([user(3, 'second')]))
    const api = { history, prompt: vi.fn() }
    const reader = createSidechainHistory(api as never)

    await reader.fetchTranscript(ADDRESS)
    reader.dispose()
    await reader.fetchTranscript(ADDRESS)

    expect(history).toHaveBeenCalledTimes(3)
    expect(history.mock.calls[2]?.[0]).toMatchObject({ maxMessages: 8 })
  })

  it('does not share a child cache between factory activations', async () => {
    const history = vi.fn().mockResolvedValue(page([
      { event: event('session/end-seed', 1, {}) }, user(2, 'hello'),
    ]))
    const api = { history, prompt: vi.fn() }

    await createSidechainHistory(api as never).fetchTranscript(ADDRESS)
    await createSidechainHistory(api as never).fetchTranscript(ADDRESS)

    expect(history).toHaveBeenCalledTimes(2)
  })
})
