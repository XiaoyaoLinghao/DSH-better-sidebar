// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement, Profiler, StrictMode, type ReactNode } from 'react'
import { act } from 'react-dom/test-utils'
import { createRoot, type Root } from 'react-dom/client'
import type {
  SidebarSessionList,
  SidebarSubagentAddress,
  SidebarSubagentCatalog,
} from '../src/context-types.ts'
import type { BetterSidebarService, SessionScope, SidebarTab } from '../src/client/service.ts'
import type { SidechainController } from '../src/client/sidechain/controller.ts'
import type { SidechainHistory } from '../src/client/sidechain/history.ts'
import { createSidechainHistory } from '../src/client/sidechain/history.ts'
import type { TranscriptRow } from '../src/client/sidechain/transcript.ts'
import { SidechainView } from '../src/client/sidechain/SidechainView.tsx'
import { getSidechainLabels } from '../src/client/locales.ts'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

function mount(node: ReactNode): { container: HTMLDivElement; root: Root; rerender: (next: ReactNode) => void } {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  act(() => { root.render(node) })
  return { container, root, rerender: next => { act(() => { root.render(next) }) } }
}

function unmount(root: Root, container: HTMLElement): void {
  act(() => { root.unmount() })
  container.remove()
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

function feed(initial: SidebarSessionList) {
  let snapshot = initial
  const listeners = new Set<() => void>()
  return {
    list: {
      getSnapshot: () => snapshot,
      subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener) },
    },
    set(next: SidebarSessionList) { snapshot = next; for (const listener of listeners) listener() },
  }
}

function catalog(overrides: Partial<SidebarSubagentCatalog> = {}): SidebarSubagentCatalog {
  return { entries: [], parentAvailable: true, state: 'ready', error: null, ...overrides }
}

function props(
  sessionFeed: ReturnType<typeof feed>,
  options: { visible?: boolean; meta?: unknown; parentSessionId?: string; history?: Partial<SidechainHistory> } = {},
) {
  const scope: SessionScope = { sessionId: options.parentSessionId ?? 'parent' }
  const controller: SidechainController = {
    selectChild: vi.fn(), clearStaleSelection: vi.fn(), claimSideChild: vi.fn(() => false),
    deferGenericCandidate: vi.fn(), resetSession: vi.fn(), dispose: vi.fn(),
  }
  const history = {
    fetchTranscript: vi.fn(async () => ({ rows: [], produced: [], streaming: false, hasMore: false })),
    fetchActivity: vi.fn(async () => null), sendPrompt: vi.fn(async () => true), dispose: vi.fn(),
    ...options.history,
  } as SidechainHistory
  const ctx = { sessions: sessionFeed } as never
  const service = { openFile: vi.fn() } as unknown as BetterSidebarService
  const tab = { id: 'sidechain', type: 'sidechain', title: 'Sidechain', meta: options.meta } as unknown as SidebarTab
  return { ctx, service, scope, tab, visible: options.visible ?? true, controller, history }
}

const child = (id: string, mode: 'one-shot' | 'continuable' = 'continuable', activity: 'running' | 'inactive' = 'inactive') => ({
  kind: 'child' as const, id, mode, activity, hasChildren: false, label: undefined,
})

function transcriptSnapshot(rows: readonly TranscriptRow[] = [], overrides: Partial<Awaited<ReturnType<SidechainHistory['fetchTranscript']>>> = {}) {
  return { rows, produced: [], streaming: false, hasMore: false, ...overrides }
}

describe('SidechainView list shell', () => {
  beforeEach(() => { document.body.innerHTML = '' })
  afterEach(() => { vi.useRealTimers() })

  it('does not flash old activity in the parent-switch commit before passive effects', async () => {
    vi.useFakeTimers()
    const sessionFeed = feed({
      current: 'parent', byId: {},
      subagentsByParent: {
        parent: catalog({ entries: [{ ...child('same', 'continuable', 'running'), label: 'parent A row' }] }),
        other: catalog({ entries: [{ ...child('same', 'continuable', 'running'), label: 'parent B row' }] }),
      },
    })
    const fetchActivity = vi.fn(async (address: SidebarSubagentAddress) =>
      address.parentSessionId === 'parent' ? 'old parent line' : null,
    )
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const commits: string[] = []
    const onRender = vi.fn(() => { commits.push(container.textContent ?? '') })
    const renderView = (viewProps: ReturnType<typeof props>) => createElement(
      Profiler,
      { id: 'sidechain', onRender },
      createElement(SidechainView, viewProps),
    )
    const initial = props(sessionFeed, { history: { fetchActivity } })
    act(() => { root.render(renderView(initial)) })
    await act(async () => { await Promise.resolve() })
    expect(container.textContent).toContain('old parent line')
    const commitsBeforeSwitch = commits.length

    const next = props(sessionFeed, { parentSessionId: 'other', history: { fetchActivity } })
    act(() => { root.render(renderView(next)) })
    const switchCommits = commits.slice(commitsBeforeSwitch)
    expect(switchCommits.length).toBeGreaterThan(0)
    expect(switchCommits[0]).toContain('parent B row')
    expect(switchCommits[0]).not.toContain('old parent line')
    unmount(root, container)
  })

  it('renders loading, empty, error, and direct children from the current parent catalog', () => {
    const sessionFeed = feed({ current: 'parent', byId: { parent: { id: 'parent', displayTitle: 'Parent' } }, subagentsByParent: {} })
    const mounted = mount(createElement(SidechainView, props(sessionFeed)))
    expect(mounted.container.textContent).toContain(getSidechainLabels().sidechainLoading)
    act(() => { sessionFeed.set({ ...sessionFeed.list.getSnapshot(), subagentsByParent: { parent: catalog() } }) })
    expect(mounted.container.textContent).toContain(getSidechainLabels().sidechainEmpty)
    act(() => { sessionFeed.set({ ...sessionFeed.list.getSnapshot(), subagentsByParent: { parent: catalog({ state: 'error', error: { message: 'broken' } }) } }) })
    expect(mounted.container.textContent).toContain(getSidechainLabels().sidechainError)
    act(() => { sessionFeed.set({ ...sessionFeed.list.getSnapshot(), subagentsByParent: { parent: catalog({ entries: [child('a'), child('b', 'one-shot')] }) } }) })
    expect(mounted.container.querySelectorAll('[data-sidechain-row]')).toHaveLength(2)
    expect(mounted.container.textContent).toContain('a')
    expect(mounted.container.textContent).toContain('b')
    unmount(mounted.root, mounted.container)
  })

  it('renders catalog diagnostics with the three localized labels', () => {
    const labels = getSidechainLabels()
    const sessionFeed = feed({
      current: 'parent', byId: { parent: { id: 'parent', displayTitle: 'Parent' } },
      subagentsByParent: { parent: catalog({ entries: [
        { kind: 'diagnostic', id: 'bad', reason: 'corrupt' },
        { kind: 'diagnostic', id: 'old', reason: 'unsupported' },
        { kind: 'diagnostic', id: 'gone', reason: 'unavailable' },
      ] }) },
    })
    const mounted = mount(createElement(SidechainView, props(sessionFeed)))
    expect(mounted.container.textContent).toContain(labels.sidechainDiagnosticCorrupt)
    expect(mounted.container.textContent).toContain(labels.sidechainDiagnosticUnsupported)
    expect(mounted.container.textContent).toContain(labels.sidechainDiagnosticUnavailable)
    unmount(mounted.root, mounted.container)
  })

  it('observes only the current parent while visible and releases it when hidden', () => {
    const sessionFeed = feed({ current: 'parent', byId: {}, subagentsByParent: { parent: catalog() } })
    const setOpen = vi.fn()
    const mounted = mount(createElement(SidechainView, { ...props(sessionFeed), ctx: { sessions: { ...sessionFeed, setSubagentCatalogOpen: setOpen } } as never }))
    expect(setOpen).toHaveBeenCalledWith('parent', true)
    mounted.rerender(createElement(SidechainView, { ...props(sessionFeed, { visible: false }), ctx: { sessions: { ...sessionFeed, setSubagentCatalogOpen: setOpen } } as never }))
    expect(setOpen).toHaveBeenLastCalledWith('parent', false)
    expect(setOpen.mock.calls.some(call => call[0] !== 'parent')).toBe(false)
    unmount(mounted.root, mounted.container)
  })

  it('polls activity only for running rows and stops polling while hidden', async () => {
    vi.useFakeTimers()
    const sessionFeed = feed({ current: 'parent', byId: {}, subagentsByParent: { parent: catalog({ entries: [child('run', 'continuable', 'running'), child('done')] }) } })
    const fetchActivity = vi.fn(async (address: SidebarSubagentAddress) => address.childSessionId)
    const mounted = mount(createElement(SidechainView, props(sessionFeed, { history: { fetchActivity } })))
    await act(async () => { await Promise.resolve() })
    expect(fetchActivity).toHaveBeenCalledTimes(1)
    expect(fetchActivity).toHaveBeenCalledWith(expect.objectContaining({ childSessionId: 'run', parentSessionId: 'parent' }), expect.any(AbortSignal))
    await act(async () => { vi.advanceTimersByTime(3000); await Promise.resolve() })
    expect(fetchActivity).toHaveBeenCalledTimes(2)
    mounted.rerender(createElement(SidechainView, props(sessionFeed, { visible: false, history: { fetchActivity } })))
    await act(async () => { vi.advanceTimersByTime(9000); await Promise.resolve() })
    expect(fetchActivity).toHaveBeenCalledTimes(2)
    unmount(mounted.root, mounted.container)
  })

  it('drops activity text when a row stops running', async () => {
    vi.useFakeTimers()
    const sessionFeed = feed({
      current: 'parent', byId: {},
      subagentsByParent: { parent: catalog({ entries: [child('run', 'continuable', 'running')] }) },
    })
    const fetchActivity = vi.fn(async (address: SidebarSubagentAddress) => `activity:${address.childSessionId}`)
    const mounted = mount(createElement(SidechainView, props(sessionFeed, { history: { fetchActivity } })))
    await act(async () => { await Promise.resolve() })
    expect(mounted.container.textContent).toContain('activity:run')

    act(() => {
      sessionFeed.set({
        ...sessionFeed.list.getSnapshot(),
        subagentsByParent: { parent: catalog({ entries: [child('run'), child('other', 'continuable', 'running')] }) },
      })
    })
    expect(mounted.container.textContent).not.toContain('activity:run')
    unmount(mounted.root, mounted.container)
  })

  it('selects a child, renders a temporary detail placeholder, and goes back', () => {
    const selectChild = vi.fn()
    const sessionFeed = feed({ current: 'parent', byId: {}, subagentsByParent: { parent: catalog({ entries: [child('a')] }) } })
    const initial = props(sessionFeed)
    initial.controller.selectChild = selectChild
    const mounted = mount(createElement(SidechainView, initial))
    const row = mounted.container.querySelector<HTMLElement>('[data-sidechain-row="a"]')!
    act(() => { row.click() })
    expect(selectChild).toHaveBeenCalledWith('parent', 'a')
    mounted.rerender(createElement(SidechainView, { ...initial, tab: { ...initial.tab, meta: { version: 1, selectedChildId: 'a' } } }))
    expect(mounted.container.querySelector('[data-sidechain-detail]')).not.toBeNull()
    expect(mounted.container.textContent).toContain(getSidechainLabels().sidechainLoading)
    act(() => { mounted.container.querySelector<HTMLButtonElement>('[data-sidechain-back]')!.click() })
    expect(selectChild).toHaveBeenLastCalledWith('parent', undefined)
    unmount(mounted.root, mounted.container)
  })

  it('clears a selected child that is no longer a direct catalog child', () => {
    const clearStaleSelection = vi.fn()
    const sessionFeed = feed({ current: 'parent', byId: {}, subagentsByParent: { parent: catalog({ entries: [child('live')] }) } })
    const initial = props(sessionFeed, { meta: { version: 1, selectedChildId: 'stale' } })
    initial.controller.clearStaleSelection = clearStaleSelection
    const mounted = mount(createElement(SidechainView, initial))
    expect(mounted.container.querySelector('[data-sidechain-detail]')).toBeNull()
    expect(clearStaleSelection).toHaveBeenCalledWith('parent', ['live'])
    unmount(mounted.root, mounted.container)
  })

  it('refreshes the current parent catalog', () => {
    const sessionFeed = feed({ current: 'parent', byId: {}, subagentsByParent: { parent: catalog() } })
    const refreshSubagents = vi.fn(async () => {})
    const mounted = mount(createElement(SidechainView, { ...props(sessionFeed), ctx: { sessions: { ...sessionFeed, refreshSubagents } } } as never))
    act(() => { mounted.container.querySelector<HTMLButtonElement>('[data-sidechain-refresh]')!.click() })
    expect(refreshSubagents).toHaveBeenCalledWith('parent')
    unmount(mounted.root, mounted.container)
  })

  it('ignores stale activity responses after hiding', async () => {
    let resolveActivity!: (value: string | null) => void
    const pending = new Promise<string | null>(resolve => { resolveActivity = resolve })
    const sessionFeed = feed({ current: 'parent', byId: {}, subagentsByParent: { parent: catalog({ entries: [child('run', 'continuable', 'running')] }) } })
    const fetchActivity = vi.fn(() => pending)
    const mounted = mount(createElement(SidechainView, props(sessionFeed, { history: { fetchActivity } })))
    mounted.rerender(createElement(SidechainView, props(sessionFeed, { visible: false, history: { fetchActivity } })))
    await act(async () => { resolveActivity('stale line'); await pending })
    expect(mounted.container.textContent).not.toContain('stale line')
    unmount(mounted.root, mounted.container)
  })

  it('ignores stale activity responses after switching parents', async () => {
    let resolveFirst!: (value: string | null) => void
    const first = new Promise<string | null>(resolve => { resolveFirst = resolve })
    const sessionFeed = feed({
      current: 'parent', byId: {},
      subagentsByParent: {
        parent: catalog({ entries: [child('run', 'continuable', 'running')] }),
        other: catalog({ entries: [child('run', 'continuable', 'running')] }),
      },
    })
    const fetchActivity = vi.fn((address: SidebarSubagentAddress) =>
      address.parentSessionId === 'parent' ? first : Promise.resolve('fresh'),
    )
    const mounted = mount(createElement(SidechainView, props(sessionFeed, { history: { fetchActivity } })))
    mounted.rerender(createElement(SidechainView, props(sessionFeed, { parentSessionId: 'other', history: { fetchActivity } })))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(mounted.container.textContent).toContain('fresh')

    await act(async () => { resolveFirst('stale'); await first })
    expect(mounted.container.textContent).not.toContain('stale')
    unmount(mounted.root, mounted.container)
  })

  it('clears activity when switching parents even if the same child has no new activity', async () => {
    vi.useFakeTimers()
    let parentCalls = 0
    let resolveLate!: (value: string | null) => void
    const lateParentResponse = new Promise<string | null>(resolve => { resolveLate = resolve })
    let otherCalls = 0
    const sessionFeed = feed({
      current: 'parent', byId: {},
      subagentsByParent: {
        parent: catalog({ entries: [child('run', 'continuable', 'running')] }),
        other: catalog({ entries: [child('run', 'continuable', 'running')] }),
      },
    })
    const fetchActivity = vi.fn((address: SidebarSubagentAddress) => {
      if (address.parentSessionId === 'parent') {
        parentCalls++
        return parentCalls === 1 ? Promise.resolve('old activity') : lateParentResponse
      }
      otherCalls++
      return otherCalls === 1
        ? Promise.resolve(null)
        : Promise.reject(new Error('other unavailable'))
    })
    const mounted = mount(createElement(SidechainView, props(sessionFeed, { history: { fetchActivity } })))
    await act(async () => { await Promise.resolve() })
    expect(mounted.container.textContent).toContain('old activity')

    await act(async () => { vi.advanceTimersByTime(3000); await Promise.resolve() })
    expect(parentCalls).toBe(2)
    mounted.rerender(createElement(SidechainView, props(sessionFeed, { parentSessionId: 'other', history: { fetchActivity } })))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(mounted.container.textContent).not.toContain('old activity')

    await act(async () => { resolveLate('late parent activity'); await lateParentResponse })
    expect(mounted.container.textContent).not.toContain('late parent activity')
    await act(async () => { vi.advanceTimersByTime(3000); await Promise.resolve() })
    expect(otherCalls).toBe(2)
    expect(mounted.container.textContent).not.toContain('old activity')
    unmount(mounted.root, mounted.container)
  })

  it('reads an inactive selected child once and renders its transcript rows', async () => {
    const sessionFeed = feed({ current: 'parent', byId: {}, subagentsByParent: { parent: catalog({ entries: [child('inactive')] }) } })
    const fetchTranscript = vi.fn(async () => transcriptSnapshot([{ kind: 'user', seq: 1, text: 'hello from child' }]))
    const initial = props(sessionFeed, { meta: { version: 1, selectedChildId: 'inactive' }, history: { fetchTranscript } })
    const mounted = mount(createElement(SidechainView, initial))
    await act(async () => { await Promise.resolve() })
    expect(fetchTranscript).toHaveBeenCalledTimes(1)
    expect(mounted.container.querySelector('[data-transcript-kind="user"]')?.textContent).toContain('hello from child')
    unmount(mounted.root, mounted.container)
  })

  it('re-reads a selected running child on its local timer', async () => {
    vi.useFakeTimers()
    const sessionFeed = feed({ current: 'parent', byId: {}, subagentsByParent: { parent: catalog({ entries: [child('running', 'continuable', 'running')] }) } })
    const fetchTranscript = vi.fn(async () => transcriptSnapshot([{ kind: 'assistant', seq: fetchTranscript.mock.calls.length, text: 'tick' }]))
    const mounted = mount(createElement(SidechainView, props(sessionFeed, {
      meta: { version: 1, selectedChildId: 'running' }, history: { fetchTranscript },
    })))
    await act(async () => { await Promise.resolve() })
    expect(fetchTranscript).toHaveBeenCalledTimes(1)
    await act(async () => { vi.advanceTimersByTime(3000); await Promise.resolve() })
    expect(fetchTranscript).toHaveBeenCalledTimes(2)
    unmount(mounted.root, mounted.container)
  })

  it('does not read a selected child while hidden', async () => {
    const sessionFeed = feed({ current: 'parent', byId: {}, subagentsByParent: { parent: catalog({ entries: [child('running', 'continuable', 'running')] }) } })
    const fetchTranscript = vi.fn(async () => transcriptSnapshot())
    const mounted = mount(createElement(SidechainView, props(sessionFeed, {
      visible: false, meta: { version: 1, selectedChildId: 'running' }, history: { fetchTranscript },
    })))
    await act(async () => { await Promise.resolve() })
    expect(fetchTranscript).not.toHaveBeenCalled()
    unmount(mounted.root, mounted.container)
  })

  it('reads once for every StrictMode visible selected setup', async () => {
    const sessionFeed = feed({ current: 'parent', byId: {}, subagentsByParent: { parent: catalog({ entries: [child('strict')] }) } })
    const fetchTranscript = vi.fn(async () => transcriptSnapshot())
    const initial = props(sessionFeed, { meta: { version: 1, selectedChildId: 'strict' }, history: { fetchTranscript } })
    const mounted = mount(createElement(StrictMode, null, createElement(SidechainView, initial)))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(fetchTranscript).toHaveBeenCalledTimes(2)
    unmount(mounted.root, mounted.container)
  })

  it('reads again when a selected child becomes visible', async () => {
    const sessionFeed = feed({ current: 'parent', byId: {}, subagentsByParent: { parent: catalog({ entries: [child('revealed')] }) } })
    const fetchTranscript = vi.fn(async () => transcriptSnapshot())
    const initial = props(sessionFeed, {
      visible: false, meta: { version: 1, selectedChildId: 'revealed' }, history: { fetchTranscript },
    })
    const mounted = mount(createElement(SidechainView, initial))
    expect(fetchTranscript).not.toHaveBeenCalled()
    mounted.rerender(createElement(SidechainView, { ...initial, visible: true }))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(fetchTranscript).toHaveBeenCalledTimes(1)
    unmount(mounted.root, mounted.container)
  })

  it('performs a final transcript read when a running child becomes inactive', async () => {
    const sessionFeed = feed({ current: 'parent', byId: {}, subagentsByParent: { parent: catalog({ entries: [child('settling', 'continuable', 'running')] }) } })
    const fetchTranscript = vi.fn(async () => transcriptSnapshot())
    const initial = props(sessionFeed, { meta: { version: 1, selectedChildId: 'settling' }, history: { fetchTranscript } })
    const mounted = mount(createElement(SidechainView, initial))
    await act(async () => { await Promise.resolve() })
    expect(fetchTranscript).toHaveBeenCalledTimes(1)
    act(() => {
      sessionFeed.set({ ...sessionFeed.list.getSnapshot(), subagentsByParent: { parent: catalog({ entries: [child('settling')] }) } })
    })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(fetchTranscript).toHaveBeenCalledTimes(2)
    unmount(mounted.root, mounted.container)
  })

  it('aborts the selected transcript request when unmounted', async () => {
    const pending = new Promise<Awaited<ReturnType<SidechainHistory['fetchTranscript']>>>(() => {})
    const sessionFeed = feed({ current: 'parent', byId: {}, subagentsByParent: { parent: catalog({ entries: [child('unmount')] }) } })
    const fetchTranscript = vi.fn((_address: SidebarSubagentAddress, signal?: AbortSignal) => {
      expect(signal).toBeInstanceOf(AbortSignal)
      return pending
    })
    const mounted = mount(createElement(SidechainView, props(sessionFeed, {
      meta: { version: 1, selectedChildId: 'unmount' }, history: { fetchTranscript },
    })))
    await act(async () => { await Promise.resolve() })
    const signal = fetchTranscript.mock.calls[0]?.[1] as AbortSignal
    unmount(mounted.root, mounted.container)
    expect(signal.aborted).toBe(true)
  })

  it('does not overlap slow running transcript reads', async () => {
    vi.useFakeTimers()
    let resolveFirst!: (snapshot: Awaited<ReturnType<SidechainHistory['fetchTranscript']>>) => void
    const first = new Promise<Awaited<ReturnType<SidechainHistory['fetchTranscript']>>>(resolve => { resolveFirst = resolve })
    const sessionFeed = feed({ current: 'parent', byId: {}, subagentsByParent: { parent: catalog({ entries: [child('slow', 'continuable', 'running')] }) } })
    const fetchTranscript = vi.fn(() => first)
    const mounted = mount(createElement(SidechainView, props(sessionFeed, {
      meta: { version: 1, selectedChildId: 'slow' }, history: { fetchTranscript },
    })))
    expect(fetchTranscript).toHaveBeenCalledTimes(1)
    await act(async () => { vi.advanceTimersByTime(9000); await Promise.resolve() })
    expect(fetchTranscript).toHaveBeenCalledTimes(1)
    await act(async () => { resolveFirst(transcriptSnapshot()); await first })
    await act(async () => { vi.advanceTimersByTime(3000); await Promise.resolve() })
    expect(fetchTranscript).toHaveBeenCalledTimes(2)
    unmount(mounted.root, mounted.container)
  })

  it('retries with one fresh timer after a running transcript error', async () => {
    vi.useFakeTimers()
    const sessionFeed = feed({ current: 'parent', byId: {}, subagentsByParent: { parent: catalog({ entries: [child('retry-running', 'continuable', 'running')] }) } })
    const fetchTranscript = vi.fn()
      .mockRejectedValueOnce(new Error('temporary'))
      .mockResolvedValue(transcriptSnapshot([{ kind: 'assistant', seq: 1, text: 'ok' }]))
    const mounted = mount(createElement(SidechainView, props(sessionFeed, {
      meta: { version: 1, selectedChildId: 'retry-running' }, history: { fetchTranscript },
    })))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(mounted.container.querySelector('[data-sidechain-transcript-error]')).not.toBeNull()
    act(() => { mounted.container.querySelector<HTMLButtonElement>('[data-sidechain-transcript-retry]')!.click() })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(fetchTranscript).toHaveBeenCalledTimes(2)
    await act(async () => { vi.advanceTimersByTime(2999); await Promise.resolve() })
    expect(fetchTranscript).toHaveBeenCalledTimes(2)
    await act(async () => { vi.advanceTimersByTime(1); await Promise.resolve() })
    expect(fetchTranscript).toHaveBeenCalledTimes(3)
    unmount(mounted.root, mounted.container)
  })

  it('surfaces a real history RPC failure and succeeds after retry', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ result: { ok: false, error: { code: 'offline', message: 'offline' } } })
      .mockResolvedValueOnce({ result: { ok: true, value: { events: [
        { event: { type: 'session/end-seed', seq: 1, time: 0, data: {} } },
        { event: { type: 'user/message', seq: 2, time: 0, data: { content: [{ type: 'text', text: 'recovered' }] } } },
      ], hasMore: false } } })
    const history = createSidechainHistory({ history: rpc, prompt: vi.fn() } as never)
    const sessionFeed = feed({ current: 'parent', byId: {}, subagentsByParent: { parent: catalog({ entries: [child('real-failure')] }) } })
    const mounted = mount(createElement(SidechainView, props(sessionFeed, {
      meta: { version: 1, selectedChildId: 'real-failure' }, history,
    })))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(mounted.container.querySelector('[data-sidechain-transcript-error]')).not.toBeNull()
    act(() => { mounted.container.querySelector<HTMLButtonElement>('[data-sidechain-transcript-retry]')!.click() })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(mounted.container.textContent).toContain('recovered')
    expect(rpc).toHaveBeenCalledTimes(2)
    unmount(mounted.root, mounted.container)
  })

  it('aborts and ignores a stale transcript response after selection changes', async () => {
    let resolveOld!: (snapshot: Awaited<ReturnType<SidechainHistory['fetchTranscript']>>) => void
    const oldPromise = new Promise<Awaited<ReturnType<SidechainHistory['fetchTranscript']>>>(resolve => { resolveOld = resolve })
    const sessionFeed = feed({ current: 'parent', byId: {}, subagentsByParent: { parent: catalog({ entries: [child('old'), child('new')] }) } })
    const fetchTranscript = vi.fn((address: SidebarSubagentAddress, _signal?: AbortSignal) => address.childSessionId === 'old'
      ? oldPromise
      : Promise.resolve(transcriptSnapshot([{ kind: 'assistant', seq: 2, text: 'new transcript' }])))
    const initial = props(sessionFeed, { meta: { version: 1, selectedChildId: 'old' }, history: { fetchTranscript } })
    const mounted = mount(createElement(SidechainView, initial))
    const next = { ...initial, tab: { ...initial.tab, meta: { version: 1, selectedChildId: 'new' } } }
    mounted.rerender(createElement(SidechainView, next))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(fetchTranscript).toHaveBeenCalledTimes(2)
    expect(fetchTranscript.mock.calls[0]?.[1]).toBeInstanceOf(AbortSignal)
    expect((fetchTranscript.mock.calls[0]?.[1] as AbortSignal).aborted).toBe(true)
    expect(mounted.container.textContent).toContain('new transcript')
    await act(async () => { resolveOld(transcriptSnapshot([{ kind: 'assistant', seq: 3, text: 'stale transcript' }])); await oldPromise })
    expect(mounted.container.textContent).not.toContain('stale transcript')
    unmount(mounted.root, mounted.container)
  })

  it('renders a transcript error and retries the selected child', async () => {
    const sessionFeed = feed({ current: 'parent', byId: {}, subagentsByParent: { parent: catalog({ entries: [child('retry')] }) } })
    const fetchTranscript = vi.fn()
      .mockRejectedValueOnce(new Error('history unavailable'))
      .mockResolvedValueOnce(transcriptSnapshot([{ kind: 'user', seq: 1, text: 'recovered' }]))
    const mounted = mount(createElement(SidechainView, props(sessionFeed, {
      meta: { version: 1, selectedChildId: 'retry' }, history: { fetchTranscript },
    })))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(mounted.container.querySelector('[data-sidechain-transcript-error]')).not.toBeNull()
    act(() => { mounted.container.querySelector<HTMLButtonElement>('[data-sidechain-transcript-retry]')!.click() })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(fetchTranscript).toHaveBeenCalledTimes(2)
    expect(mounted.container.textContent).toContain('recovered')
    unmount(mounted.root, mounted.container)
  })

  it('renders streaming only on the transcript tail and opens produced files through the service', async () => {
    const sessionFeed = feed({ current: 'parent', byId: {}, subagentsByParent: { parent: catalog({ entries: [child('files')] }) } })
    const fetchTranscript = vi.fn(async () => transcriptSnapshot([
      { kind: 'assistant', seq: 1, text: 'earlier `src/out.ts`' },
      { kind: 'assistant', seq: 2, text: 'live' },
    ], { streaming: true, produced: ['/work/src/out.ts'] }))
    const initial = props(sessionFeed, { meta: { version: 1, selectedChildId: 'files' }, history: { fetchTranscript } })
    initial.scope.cwd = '/work'
    const mounted = mount(createElement(SidechainView, initial))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    const rows = [...mounted.container.querySelectorAll<HTMLElement>('[data-transcript-kind="assistant"]')]
    expect(rows).toHaveLength(2)
    expect(rows[0]?.getAttribute('data-streaming')).toBe('false')
    expect(rows[1]?.getAttribute('data-streaming')).toBe('true')
    const link = mounted.container.querySelector<HTMLButtonElement>(`button[aria-label="${getSidechainLabels().sidechainOpenFile}: out.ts"]`)
    expect(link).not.toBeNull()
    act(() => { link!.click() })
    expect((initial.service.openFile as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(initial.scope, '/work/src/out.ts')
    unmount(mounted.root, mounted.container)
  })

  it('does not poll activity while a catalog is loading or in error', async () => {
    vi.useFakeTimers()
    const entries = [child('run', 'continuable', 'running')]
    const sessionFeed = feed({
      current: 'parent', byId: {},
      subagentsByParent: { parent: catalog({ entries }) },
    })
    const fetchActivity = vi.fn(async (address: SidebarSubagentAddress) => address.childSessionId)
    const mounted = mount(createElement(SidechainView, props(sessionFeed, { history: { fetchActivity } })))
    await act(async () => { await Promise.resolve() })
    expect(fetchActivity).toHaveBeenCalledTimes(1)

    act(() => {
      sessionFeed.set({
        ...sessionFeed.list.getSnapshot(),
        subagentsByParent: { parent: catalog({ state: 'loading', entries }) },
      })
    })
    await act(async () => { vi.advanceTimersByTime(6000); await Promise.resolve() })
    expect(fetchActivity).toHaveBeenCalledTimes(1)

    act(() => {
      sessionFeed.set({
        ...sessionFeed.list.getSnapshot(),
        subagentsByParent: { parent: catalog({ state: 'error', entries, error: { message: 'unavailable' } }) },
      })
    })
    await act(async () => { vi.advanceTimersByTime(6000); await Promise.resolve() })
    expect(fetchActivity).toHaveBeenCalledTimes(1)
    unmount(mounted.root, mounted.container)
  })

  it('renders a localized read-only footer for one-shot children and rejects trimmed-empty prompts', async () => {
    const sendPrompt = vi.fn(async () => true)
    const sessionFeed = feed({ current: 'parent', byId: {}, subagentsByParent: { parent: catalog({ entries: [child('btw', 'one-shot')] }) } })
    const mounted = mount(createElement(SidechainView, props(sessionFeed, {
      meta: { version: 1, selectedChildId: 'btw' }, history: { sendPrompt },
    })))
    await act(async () => { await Promise.resolve() })
    expect(mounted.container.querySelector('[data-sidechain-read-only]')?.textContent)
      .toContain(getSidechainLabels().sidechainReadOnly)
    expect(mounted.container.querySelector('[data-sidechain-composer]')).toBeNull()

    const sessionFeed2 = feed({ current: 'parent', byId: {}, subagentsByParent: { parent: catalog({ entries: [child('side')] }) } })
    const mounted2 = mount(createElement(SidechainView, props(sessionFeed2, {
      meta: { version: 1, selectedChildId: 'side' }, history: { sendPrompt },
    })))
    const input = mounted2.container.querySelector<HTMLInputElement>('[data-sidechain-composer-input]')!
    const form = mounted2.container.querySelector<HTMLFormElement>('[data-sidechain-composer]')!
    act(() => {
      setInputValue(input, '   ')
      form.requestSubmit()
    })
    expect(sendPrompt).not.toHaveBeenCalled()
    unmount(mounted.root, mounted.container)
    unmount(mounted2.root, mounted2.container)
  })

  it('keeps continuation single-flight across button and Enter submission', async () => {
    let resolvePrompt!: (value: boolean) => void
    const pending = new Promise<boolean>(resolve => { resolvePrompt = resolve })
    const sendPrompt = vi.fn(() => pending)
    const sessionFeed = feed({ current: 'parent', byId: {}, subagentsByParent: { parent: catalog({ entries: [child('side')] }) } })
    const mounted = mount(createElement(SidechainView, props(sessionFeed, {
      meta: { version: 1, selectedChildId: 'side' }, history: { sendPrompt },
    })))
    const input = mounted.container.querySelector<HTMLInputElement>('[data-sidechain-composer-input]')!
    const form = mounted.container.querySelector<HTMLFormElement>('[data-sidechain-composer]')!
    const submit = mounted.container.querySelector<HTMLButtonElement>('[data-sidechain-composer-submit]')!
    act(() => {
      setInputValue(input, 'continue this')
      submit.click()
      form.requestSubmit()
    })
    expect(sendPrompt).toHaveBeenCalledTimes(1)
    expect(submit.disabled).toBe(true)
    await act(async () => { resolvePrompt(true); await pending })
    expect(input.value).toBe('')
    unmount(mounted.root, mounted.container)
  })

  it('preserves a failed draft for retry and refreshes from the transcript source of truth after admission', async () => {
    const sendPrompt = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
    const fetchTranscript = vi.fn(async () => transcriptSnapshot())
    const sessionFeed = feed({ current: 'parent', byId: {}, subagentsByParent: { parent: catalog({ entries: [child('side')] }) } })
    const mounted = mount(createElement(SidechainView, props(sessionFeed, {
      meta: { version: 1, selectedChildId: 'side' }, history: { sendPrompt, fetchTranscript },
    })))
    const input = mounted.container.querySelector<HTMLInputElement>('[data-sidechain-composer-input]')!
    const form = mounted.container.querySelector<HTMLFormElement>('[data-sidechain-composer]')!
    act(() => {
      setInputValue(input, 'please continue')
      form.requestSubmit()
    })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(input.value).toBe('please continue')
    expect(mounted.container.textContent).toContain(getSidechainLabels().sidechainPromptFailed)

    act(() => { form.requestSubmit() })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(sendPrompt).toHaveBeenCalledTimes(2)
    expect(input.value).toBe('')
    expect(fetchTranscript).toHaveBeenCalledTimes(2)
    expect(mounted.container.querySelector('[data-transcript-kind="user"]')).toBeNull()
    unmount(mounted.root, mounted.container)
  })

  it('aborts and ignores a stale continuation after selection changes', async () => {
    let resolvePrompt!: (value: boolean) => void
    const sendPrompt = vi.fn((_address: unknown, _text: string, signal: AbortSignal) => {
      expect(signal).toBeInstanceOf(AbortSignal)
      return new Promise<boolean>(resolve => { resolvePrompt = resolve })
    })
    const sessionFeed = feed({ current: 'parent', byId: {}, subagentsByParent: { parent: catalog({ entries: [child('old'), child('new')] }) } })
    const initial = props(sessionFeed, { meta: { version: 1, selectedChildId: 'old' }, history: { sendPrompt } })
    const mounted = mount(createElement(SidechainView, initial))
    const oldInput = mounted.container.querySelector<HTMLInputElement>('[data-sidechain-composer-input]')!
    act(() => {
      setInputValue(oldInput, 'old draft')
      mounted.container.querySelector<HTMLFormElement>('[data-sidechain-composer]')!.requestSubmit()
    })
    const signal = sendPrompt.mock.calls[0]?.[2] as AbortSignal
    mounted.rerender(createElement(SidechainView, {
      ...initial, tab: { ...initial.tab, meta: { version: 1, selectedChildId: 'new' } },
    }))
    expect(signal.aborted).toBe(true)
    expect(mounted.container.querySelector<HTMLInputElement>('[data-sidechain-composer-input]')?.value).toBe('')
    await act(async () => { resolvePrompt(true); await Promise.resolve() })
    expect(mounted.container.querySelector<HTMLInputElement>('[data-sidechain-composer-input]')?.value).toBe('')
    unmount(mounted.root, mounted.container)
  })

  it('confirms an admitted prompt against later history and stops at a bounded retry limit', async () => {
    vi.useFakeTimers()
    const oldSnapshot = transcriptSnapshot([{ kind: 'assistant', seq: 1, text: 'before' }])
    const newSnapshot = transcriptSnapshot([
      { kind: 'assistant', seq: 1, text: 'before' },
      { kind: 'user', seq: 2, text: 'confirmed' },
    ])
    let historyRead = 0
    const fetchTranscript = vi.fn(async () => {
      historyRead++
      return historyRead < 3 ? oldSnapshot : newSnapshot
    })
    const sendPrompt = vi.fn(async () => true)
    const sessionFeed = feed({ current: 'parent', byId: {}, subagentsByParent: { parent: catalog({ entries: [child('side')] }) } })
    const mounted = mount(createElement(SidechainView, props(sessionFeed, {
      meta: { version: 1, selectedChildId: 'side' }, history: { fetchTranscript, sendPrompt },
    })))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    const input = mounted.container.querySelector<HTMLInputElement>('[data-sidechain-composer-input]')!
    setInputValue(input, 'confirmed')
    act(() => { mounted.container.querySelector<HTMLFormElement>('[data-sidechain-composer]')!.requestSubmit() })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(fetchTranscript).toHaveBeenCalledTimes(2)
    await act(async () => { vi.advanceTimersByTime(250); await Promise.resolve(); await Promise.resolve() })
    expect(fetchTranscript).toHaveBeenCalledTimes(3)
    expect(mounted.container.textContent).toContain('confirmed')

    const readsAfterConfirmation = fetchTranscript.mock.calls.length
    await act(async () => { vi.advanceTimersByTime(5000); await Promise.resolve() })
    expect(fetchTranscript.mock.calls.length).toBe(readsAfterConfirmation)
    unmount(mounted.root, mounted.container)
  })

  it('keeps drafts per child and does not let a stale admission clear or refresh the new child', async () => {
    let resolveOld!: (value: boolean) => void
    const sendPrompt = vi.fn((address: SidebarSubagentAddress) => address.childSessionId === 'old'
      ? new Promise<boolean>(resolve => { resolveOld = resolve })
      : Promise.resolve(true))
    const fetchTranscript = vi.fn(async (address: SidebarSubagentAddress) => transcriptSnapshot([
      { kind: 'assistant', seq: address.childSessionId === 'old' ? 1 : 10, text: `${address.childSessionId} history` },
    ]))
    const sessionFeed = feed({ current: 'parent', byId: {}, subagentsByParent: { parent: catalog({ entries: [child('old'), child('new')] }) } })
    const initial = props(sessionFeed, { meta: { version: 1, selectedChildId: 'old' }, history: { sendPrompt, fetchTranscript } })
    const mounted = mount(createElement(SidechainView, initial))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    const oldInput = mounted.container.querySelector<HTMLInputElement>('[data-sidechain-composer-input]')!
    setInputValue(oldInput, 'old draft')
    act(() => { mounted.container.querySelector<HTMLFormElement>('[data-sidechain-composer]')!.requestSubmit() })
    mounted.rerender(createElement(SidechainView, {
      ...initial, tab: { ...initial.tab, meta: { version: 1, selectedChildId: 'new' } },
    }))
    const newInput = mounted.container.querySelector<HTMLInputElement>('[data-sidechain-composer-input]')!
    expect(newInput.value).toBe('')
    setInputValue(newInput, 'new draft')
    mounted.rerender(createElement(SidechainView, initial))
    expect(mounted.container.querySelector<HTMLInputElement>('[data-sidechain-composer-input]')?.value).toBe('old draft')
    const newReadsBeforeLate = fetchTranscript.mock.calls.filter(call => call[0].childSessionId === 'new').length
    await act(async () => { resolveOld(true); await Promise.resolve(); await Promise.resolve() })
    expect(mounted.container.querySelector<HTMLInputElement>('[data-sidechain-composer-input]')?.value).toBe('old draft')
    expect(fetchTranscript.mock.calls.filter(call => call[0].childSessionId === 'new')).toHaveLength(newReadsBeforeLate)
    mounted.rerender(createElement(SidechainView, {
      ...initial, tab: { ...initial.tab, meta: { version: 1, selectedChildId: 'new' } },
    }))
    expect(mounted.container.querySelector<HTMLInputElement>('[data-sidechain-composer-input]')?.value).toBe('new draft')
    unmount(mounted.root, mounted.container)
  })

  it('uses the exact continuable address and trimmed text, disables empty submit, and ignores IME Enter', async () => {
    const sendPrompt = vi.fn(async () => true)
    const sessionFeed = feed({ current: 'parent', byId: {}, subagentsByParent: { parent: catalog({ entries: [child('side')] }) } })
    const mounted = mount(createElement(SidechainView, props(sessionFeed, {
      meta: { version: 1, selectedChildId: 'side' }, history: { sendPrompt },
    })))
    const input = mounted.container.querySelector<HTMLInputElement>('[data-sidechain-composer-input]')!
    const form = mounted.container.querySelector<HTMLFormElement>('[data-sidechain-composer]')!
    const submit = mounted.container.querySelector<HTMLButtonElement>('[data-sidechain-composer-submit]')!
    expect(submit.disabled).toBe(true)
    act(() => {
      input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, isComposing: true }))
      form.requestSubmit()
    })
    expect(sendPrompt).not.toHaveBeenCalled()
    act(() => {
      input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
      setInputValue(input, '  exact prompt  ')
      form.requestSubmit()
    })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(sendPrompt).toHaveBeenCalledWith(
      { parentSessionId: 'parent', childSessionId: 'side', mode: 'continuable' },
      'exact prompt',
      expect.any(AbortSignal),
    )
    unmount(mounted.root, mounted.container)
  })
})
