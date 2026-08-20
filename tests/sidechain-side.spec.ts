import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {
  ContinuableStart,
  SubagentListEntry,
  SubagentRun,
} from '@deepseek-ai/dsh-subagent'
import { describe, expect, it, vi } from 'vitest'
import {
  SIDE_BOUNDARY_PROMPT,
  SIDE_MODE_LINE,
  SIDE_PERSONA,
  sidePrompt,
  type SideMode,
} from '../src/sidechain-host/prompts.ts'
import {
  askSideOneShot,
  formatSideList,
  startSideConversation,
  truncateLabel,
  type SideDeps,
  type SubagentsLike,
} from '../src/sidechain-host/side.ts'

const PARENT_ID = 'parent-1' as SessionId
const CHILD_ID = 'child-9' as SessionId
const parent = { session: { id: PARENT_ID } } as unknown as Agent
const signal = new AbortController().signal
const deps: SideDeps = {
  providerName: 'fork',
  persona: SIDE_PERSONA,
  toolFilter: { allow: ['read'] },
}

function textOf(block: ContentBlock): string {
  return block.type === 'text' ? block.text : ''
}

function childEntry(
  partial: Partial<Extract<SubagentListEntry, { kind: 'child' }>> = {},
): SubagentListEntry {
  const mode = partial.mode ?? 'continuable'
  if (mode === 'continuable') {
    return {
      kind: 'child',
      id: partial.id ?? CHILD_ID,
      activity: partial.activity ?? 'inactive',
      hasChildren: partial.hasChildren ?? false,
      mode,
      label: partial.label ?? 'Side conversation',
    }
  }
  return {
    kind: 'child',
    id: partial.id ?? CHILD_ID,
    activity: partial.activity ?? 'inactive',
    hasChildren: partial.hasChildren ?? false,
    mode,
    ...(partial.label === undefined ? {} : { label: partial.label }),
  }
}

describe('side conversation prompt primitives', () => {
  it('trims the question and declares the literal BTW mode inside the boundary', () => {
    expect(sidePrompt(' inspect this ', 'btw')).toEqual({
      type: 'text',
      text: expect.stringContaining('Mode: BTW'),
    })
    const prompt = textOf(sidePrompt(' inspect this ', 'btw'))
    expect(prompt.startsWith(SIDE_BOUNDARY_PROMPT)).toBe(true)
    expect(prompt).toContain(SIDE_MODE_LINE.btw)
    expect(prompt.endsWith('inspect this')).toBe(true)
  })

  it('declares the literal continuable SIDE mode', () => {
    const prompt = textOf(sidePrompt('question', 'side'))
    expect(prompt).toContain(SIDE_MODE_LINE.side)
    expect(prompt).toContain('Mode: SIDE')
  })

  it('keeps mode restricted to side and btw literals', () => {
    const modes: SideMode[] = ['side', 'btw']
    expect(modes).toEqual(['side', 'btw'])
    expect(Object.keys(SIDE_MODE_LINE)).toEqual(['side', 'btw'])
  })
})

describe('side conversation start primitives', () => {
  it('requests a one-shot fork with the configured provider fields', async () => {
    const run = {} as SubagentRun
    const start = vi.fn().mockResolvedValue(run)
    const subagents = { start } as unknown as SubagentsLike

    await expect(askSideOneShot(subagents, parent, '  inspect this  ', deps, signal)).resolves.toBe(run)
    expect(start).toHaveBeenCalledWith('fork', {
      label: 'BTW: inspect this',
      prompt: [sidePrompt('  inspect this  ', 'btw')],
      parent,
      signal,
      persona: SIDE_PERSONA,
      toolFilter: { allow: ['read'] },
    })
  })

  it('requests a durable fork with a normalized label', async () => {
    const started = { childId: CHILD_ID, messageId: 'message-1' } as ContinuableStart
    const startContinuable = vi.fn().mockResolvedValue(started)
    const subagents = { startContinuable } as unknown as SubagentsLike

    await expect(startSideConversation(subagents, parent, '  Inspect   events  ', deps, signal)).resolves.toBe(started)
    expect(startContinuable).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'fork',
      label: 'Inspect events',
      signal,
    }))
    expect(startContinuable).toHaveBeenCalledWith({
      provider: 'fork',
      label: 'Inspect events',
      request: {
        prompt: [sidePrompt('  Inspect   events  ', 'side')],
        parent,
        persona: SIDE_PERSONA,
        toolFilter: { allow: ['read'] },
      },
      signal,
    })
  })

  it('uses a fallback label for an empty continuable question', async () => {
    const startContinuable = vi.fn().mockResolvedValue({ childId: CHILD_ID, messageId: 'message-1' })
    const subagents = { startContinuable } as unknown as SubagentsLike

    await startSideConversation(subagents, parent, '   ', deps, signal)
    expect(startContinuable).toHaveBeenCalledWith(expect.objectContaining({ label: 'Side conversation' }))
  })
})

describe('side conversation labels and lists', () => {
  it('normalizes whitespace and caps labels at 48 code points', () => {
    expect(truncateLabel('  multiple   spaces  ')).toBe('multiple spaces')
    expect(truncateLabel('x'.repeat(48))).toBe('x'.repeat(48))
    expect(truncateLabel('x'.repeat(49))).toBe(`${'x'.repeat(48)}…`)
    expect([...truncateLabel('🙂'.repeat(49))]).toHaveLength(49)
    expect(truncateLabel('🙂'.repeat(49))).toBe(`${'🙂'.repeat(48)}…`)
  })

  it('formats an empty direct-child catalog', () => {
    expect(formatSideList([])).toBe('No side conversations yet. Start one with /side <question>.')
  })

  it('formats direct children with side, btw, and diagnostic entries', () => {
    const text = formatSideList([
      childEntry({ mode: 'continuable', activity: 'running', label: 'Inspect events' }),
      childEntry({ mode: 'one-shot', label: 'BTW: quick check' }),
      { kind: 'diagnostic', id: 'child-3' as SessionId, reason: 'corrupt' },
    ])
    expect(text).toContain('- [side/running] Inspect events — child-9')
    expect(text).toContain('- [btw/inactive] BTW: quick check — child-9')
    expect(text).toContain('- [unavailable] child-3 (corrupt)')
  })
})
