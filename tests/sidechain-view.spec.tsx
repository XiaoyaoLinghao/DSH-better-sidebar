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
