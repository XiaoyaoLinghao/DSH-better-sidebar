import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import {
  blockText,
  producedPaths,
  transcriptRows,
} from '../src/client/sidechain/transcript.ts'
import type { TranscriptEntry } from '../src/client/sidechain/transcript.ts'

function event(type: SessionEvent['type'], seq: number, data: Record<string, unknown>): SessionEvent {
  return { type, seq, time: 0, data } as SessionEvent
}

function entries(...events: SessionEvent[]): TranscriptEntry[] {
  return events.map(event => ({ event }))
}

describe('blockText', () => {
  it('joins visible text blocks and uses an ellipsis for no visible text', () => {
    expect(blockText([
      { type: 'text', text: 'one' },
      { type: 'reasoning', text: 'hidden' },
      { type: 'text', text: 'two' },
    ])).toBe('one\n\ntwo')
    expect(blockText([{ type: 'reasoning', text: 'hidden' }])).toBe('…')
    expect(blockText([])).toBe('…')
  })
})

describe('transcriptRows', () => {
  it('cuts at the last seed boundary and omits the boundary prompt', () => {
    expect(transcriptRows(entries(
      event('user/message', 1, { content: [{ type: 'text', text: 'parent' }] }),
      event('session/end-seed', 2, {}),
      event('user/message', 3, { content: [{ type: 'text', text: 'Side conversation boundary.\n\nseed' }] }),
      event('assistant/message', 4, { message: { content: [{ type: 'text', text: 'child' }] } }),
      event('session/end-seed', 5, {}),
      event('user/message', 6, { content: [{ type: 'text', text: 'latest' }] }),
    ))).toEqual([{ kind: 'user', seq: 6, text: 'latest' }])
  })

  it('projects user and context provenance', () => {
    expect(transcriptRows(entries(
      event('user/message', 1, { content: [{ type: 'text', text: 'human' }], source: { kind: 'user' } }),
      event('user/message', 2, { content: [{ type: 'text', text: 'injected' }], source: { kind: 'agent-instructions', changes: [{ path: 'AGENTS.md' }] } }),
      event('user/message', 3, { content: [{ type: 'text', text: 'recalled' }], source: { kind: 'session-reference', references: [{ label: 'prior' }] } }),
    ))).toEqual([
      { kind: 'user', seq: 1, text: 'human' },
      { kind: 'context', seq: 2, text: 'injected', source: 'AGENTS.md', recall: false },
      { kind: 'context', seq: 3, text: 'recalled', source: 'prior', recall: true },
    ])
  })

  it('accumulates stream chunks and replaces them with the settled message', () => {
    const streamed = transcriptRows(entries(
      event('assistant/chunk', 1, { turn: 1, step: 2, chunk: { type: 'text-delta', index: 0, text: 'hel' } }),
      event('assistant/chunk', 2, { turn: 1, step: 2, chunk: { type: 'text-delta', index: 0, text: 'lo' } }),
      event('assistant/chunk', 3, { turn: 1, step: 2, chunk: { type: 'reasoning-delta', index: 1, text: 'think' } }),
    ))
    expect(streamed).toEqual([
      { kind: 'assistant', seq: 1, text: 'hello' },
      { kind: 'reasoning', seq: 3, text: 'think' },
    ])
    expect(transcriptRows(entries(
      event('assistant/chunk', 1, { turn: 1, step: 2, chunk: { type: 'text-delta', index: 0, text: 'hel' } }),
      event('assistant/chunk', 2, { turn: 1, step: 2, chunk: { type: 'text-delta', index: 0, text: 'lo' } }),
      event('assistant/message', 3, { turn: 1, step: 2, message: { content: [{ type: 'text', text: 'hello!' }] } }),
    ))).toEqual([{ kind: 'assistant', seq: 3, text: 'hello!' }])
  })

  it('pairs tool results and surfaces orphan failures', () => {
    expect(transcriptRows(entries(
      event('tool/call', 1, { callId: 'c1', name: 'edit', arguments: '{}' }),
      event('tool/result', 2, { message: { content: [{ type: 'tool-result', toolCallId: 'c1', content: [], isError: true }] } }),
      event('tool/result', 3, { message: { content: [{ type: 'tool-result', toolCallId: 'missing', content: [] }] }, error: { name: 'Oops', code: 'E' } }),
    ))).toEqual([
      { kind: 'tool', seq: 1, name: 'edit', failed: true, detail: { arguments: '{}' } },
      { kind: 'tool', seq: 3, name: 'tool', failed: true, detail: { error: { name: 'Oops', code: 'E' } } },
    ])
  })
})

describe('producedPaths', () => {
  it('cuts seed calls, excludes failed calls, and keeps paths unique', () => {
    expect(producedPaths([
      { event: event('tool/call', 1, { callId: 'parent', name: 'write', arguments: '{}' }), view: { for: 'call', view: { card: 'diff', title: 'parent', diffs: [], locations: [{ path: 'parent.ts' }] } } },
      { event: event('session/end-seed', 2, {}) },
      { event: event('tool/call', 3, { callId: 'failed', name: 'write', arguments: '{}' }), view: { for: 'call', view: { card: 'diff', title: 'failed', diffs: [], locations: [{ path: 'failed.ts' }] } } },
      { event: event('tool/result', 4, { message: { content: [{ type: 'tool-result', toolCallId: 'failed', content: [] }] }, error: { name: 'E', code: 'C' } }) },
      { event: event('tool/call', 5, { callId: 'ok', name: 'edit', arguments: '{}' }), view: { for: 'call', view: { card: 'generic', title: 'edit', kind: 'edit', locations: [{ path: 'made.ts' }, { path: 'parent.ts' }] } } },
    ])).toEqual(['made.ts', 'parent.ts'])
  })
})
