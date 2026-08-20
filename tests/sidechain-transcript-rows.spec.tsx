// @vitest-environment jsdom
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { getSidechainLabels, type SidechainLabels } from '../src/client/locales.ts'
import { TranscriptRows } from '../src/client/sidechain/TranscriptRows.tsx'
import type { TranscriptRow } from '../src/client/sidechain/transcript.ts'
import type { MarkdownFileMentions } from '@deepseek-ai/dsh-client-ui-primitives'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

function mount(node: ReactNode): { container: HTMLDivElement; root: Root } {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  act(() => { root.render(node) })
  return { container, root }
}

function unmount(root: Root, container: HTMLElement): void {
  act(() => { root.unmount() })
  container.remove()
}

function labels(): SidechainLabels {
  return getSidechainLabels()
}

function mentionFor(opened: string[]): MarkdownFileMentions {
  return {
    resolve(value) {
      if (value !== 'src/a.ts') return undefined
      return { label: value, title: '/workspace/src/a.ts', open: () => { opened.push(value) } }
    },
  }
}

const rows: readonly TranscriptRow[] = [
  { kind: 'user', seq: 1, text: 'A user question' },
  { kind: 'context', seq: 2, text: 'Injected context', source: 'instructions.md', recall: false },
  { kind: 'context', seq: 3, text: 'Recalled context', source: 'parent-session', recall: true },
  { kind: 'reasoning', seq: 4, text: 'A private reasoning trace' },
  { kind: 'assistant', seq: 5, text: 'An **assistant** answer\n\n```ts\nconst answer = 1\n```\n\n`src/a.ts`' },
  {
    kind: 'tool', seq: 6, name: 'read', failed: true,
    detail: { arguments: '{"path":"src/a.ts"}', error: { name: 'ToolError', code: 'ENOENT' } },
  },
]

beforeEach(() => { document.body.innerHTML = '' })
afterEach(() => { delete (navigator as unknown as { clipboard?: unknown }).clipboard })

describe('TranscriptRows', () => {
  it('renders every transcript role with localized context and reasoning labels', () => {
    const { container, root } = mount(createElement(TranscriptRows, {
      rows, streaming: false, labels: labels(), fileMentions: undefined,
    }))
    const copy = labels()
    expect(container.querySelector('[data-transcript-rows]')).not.toBeNull()
    expect(container.textContent).toContain('A user question')
    expect(container.textContent).toContain('An assistant answer')
    expect(container.textContent).toContain(copy.sidechainContext)
    expect(container.textContent).toContain(copy.sidechainRecall)
    expect(container.textContent).toContain(copy.sidechainReasoning)
    unmount(root, container)
  })

  it('expands tool details and exposes localized failure copy', () => {
    const { container, root } = mount(createElement(TranscriptRows, {
      rows, streaming: false, labels: labels(), fileMentions: undefined,
    }))
    const detailButton = container.querySelector<HTMLElement>('[data-transcript-kind="tool"] [role="button"]')
    expect(detailButton).not.toBeNull()
    expect(detailButton?.textContent).toContain(labels().sidechainToolDetails)
    expect(detailButton?.getAttribute('aria-expanded')).toBe('false')
    act(() => { detailButton!.click() })
    expect(detailButton?.getAttribute('aria-expanded')).toBe('true')
    expect(container.querySelector('[data-transcript-kind="tool"] pre')?.textContent).toContain('src/a.ts')
    expect(container.textContent).toContain(labels().sidechainToolFailed)
    expect(container.textContent).toContain('ToolError')
    unmount(root, container)
  })

  it('passes localized copy labels, streaming state, and file mentions to MarkdownText', async () => {
    const opened: string[] = []
    const current = labels()
    const { container, root } = mount(createElement(TranscriptRows, {
      rows: [{ kind: 'assistant', seq: 1, text: '```ts\nconst value = 1\n```\n\n`src/a.ts`' }],
      streaming: false, labels: current, fileMentions: mentionFor(opened),
    }))
    const copyButton = [...container.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent === current.copy)
    expect(copyButton).not.toBeNull()
    ;(navigator as unknown as { clipboard?: Clipboard }).clipboard = {
      writeText: async () => {},
    } as unknown as Clipboard
    await act(async () => { copyButton!.click() })
    expect([...container.querySelectorAll<HTMLButtonElement>('button')]
      .some(button => button.textContent === current.copied)).toBe(true)
    const fileButton = container.querySelector<HTMLButtonElement>(
      `button[aria-label="${current.sidechainOpenFile}: src/a.ts"]`,
    )
    expect(fileButton).not.toBeNull()
    act(() => { fileButton!.click() })
    expect(opened).toEqual(['src/a.ts'])
    unmount(root, container)
  })

  it('marks the latest markdown row as streaming without adding fallback transcript copy', () => {
    const { container, root } = mount(createElement(TranscriptRows, {
      rows: [{ kind: 'assistant', seq: 1, text: 'Streaming answer' }],
      streaming: true, labels: labels(), fileMentions: undefined,
    }))
    expect(container.querySelector('[data-streaming="true"]')).not.toBeNull()
    unmount(root, container)
  })

  it('marks only the final row as streaming and leaves settled earlier rows interactive', () => {
    const { container, root } = mount(createElement(TranscriptRows, {
      rows: [
        { kind: 'assistant', seq: 1, text: 'Settled answer' },
        { kind: 'tool', seq: 2, name: 'read', failed: false, detail: { arguments: '{"path":"src/a.ts"}' } },
        { kind: 'assistant', seq: 3, text: 'Live answer' },
      ],
      streaming: true, labels: labels(), fileMentions: mentionFor([]),
    }))
    expect(container.querySelectorAll('[data-streaming="true"]')).toHaveLength(1)
    expect(container.querySelector('[data-transcript-kind="assistant"][data-streaming="true"]')?.textContent)
      .toContain('Live answer')
    expect(container.querySelector('[data-transcript-kind="assistant"][data-streaming="false"]')?.textContent)
      .toContain('Settled answer')
    expect(container.querySelector('[data-transcript-kind="tool"] [role="button"]')?.getAttribute('aria-expanded'))
      .toBe('false')
    unmount(root, container)
  })

  it('expands context and recall rows to their full bodies', () => {
    const { container, root } = mount(createElement(TranscriptRows, {
      rows: [
        { kind: 'context', seq: 1, text: 'Full injected body', source: 'instructions', recall: false },
        { kind: 'context', seq: 2, text: 'Full recalled body', source: 'parent', recall: true },
        { kind: 'reasoning', seq: 3, text: 'Full reasoning body' },
      ], streaming: false, labels: labels(), fileMentions: undefined,
    }))
    const disclosures = [...container.querySelectorAll<HTMLElement>('[data-transcript-kind] [role="button"]')]
    expect(disclosures).toHaveLength(3)
    act(() => { disclosures.forEach(disclosure => disclosure.click()) })
    expect(container.textContent).toContain('Full injected body')
    expect(container.textContent).toContain('Full recalled body')
    expect(container.textContent).toContain('Full reasoning body')
    unmount(root, container)
  })

  it('renders successful and failed tool rows without duplicate-key warnings', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { container, root } = mount(createElement(TranscriptRows, {
      rows: [
        { kind: 'tool', seq: 4, name: 'read', failed: false, detail: { arguments: '{"path":"a"}' } },
        { kind: 'tool', seq: 4, name: 'write', failed: true, detail: { arguments: '{"path":"b"}', error: { name: 'Failed', code: 'EIO' } } },
      ], streaming: false, labels: labels(), fileMentions: undefined,
    }))
    expect(container.querySelectorAll('[data-transcript-kind="tool"]')).toHaveLength(2)
    expect(container.textContent).toContain(labels().sidechainToolFailed)
    expect(error.mock.calls.some(call => String(call[0]).toLowerCase().includes('duplicate key'))).toBe(false)
    error.mockRestore()
    unmount(root, container)
  })

  it('localizes resolved file mention labels and leaves unknown inline code inert', () => {
    const opened: string[] = []
    const current = labels()
    const { container, root } = mount(createElement(TranscriptRows, {
      rows: [{ kind: 'assistant', seq: 1, text: '`src/a.ts` and `unknown.ts`' }],
      streaming: false, labels: current, fileMentions: mentionFor(opened),
    }))
    const resolved = container.querySelector<HTMLButtonElement>(
      `button[aria-label="${current.sidechainOpenFile}: src/a.ts"]`,
    )
    expect(resolved).not.toBeNull()
    expect(resolved?.title).toBe('/workspace/src/a.ts')
    expect(container.querySelector('button[aria-label="unknown.ts"]')).toBeNull()
    expect(container.textContent).toContain('unknown.ts')
    act(() => { resolved!.click() })
    expect(opened).toEqual(['src/a.ts'])
    unmount(root, container)
  })

  it('prefers curated tool input and caps raw argument previews before parsing', () => {
    const long = JSON.stringify({ path: 'x'.repeat(3000) })
    const { container, root } = mount(createElement(TranscriptRows, {
      rows: [{
        kind: 'tool', seq: 1, name: 'read', failed: false,
        detail: {
          arguments: long,
          callView: { card: 'generic', title: 'Read file', rawInput: { path: 'curated.ts' } } as never,
        },
      }],
      streaming: false, labels: labels(), fileMentions: undefined,
    }))
    const disclosure = container.querySelector<HTMLElement>('[data-transcript-kind="tool"] [role="button"]')!
    act(() => { disclosure.click() })
    const preview = container.querySelector('[data-transcript-kind="tool"] pre')?.textContent ?? ''
    expect(preview).toContain('curated.ts')
    expect(preview).not.toContain('x'.repeat(3000))
    unmount(root, container)
  })
})
