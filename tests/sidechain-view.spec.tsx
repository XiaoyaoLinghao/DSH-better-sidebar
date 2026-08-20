// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement, Profiler, type ReactNode } from 'react'
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
})
