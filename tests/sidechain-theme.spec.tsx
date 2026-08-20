// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement, type ReactNode } from 'react'
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

type Theme = 'light' | 'dark'

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

async function settle(): Promise<void> {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
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

const child = (id: string, mode: 'one-shot' | 'continuable' = 'continuable', activity: 'running' | 'inactive' = 'inactive') => ({
  kind: 'child' as const, id, mode, activity, hasChildren: false, label: undefined,
})

function transcript(rows: readonly TranscriptRow[] = [], produced: readonly string[] = []) {
  return { rows, produced, streaming: false, hasMore: false }
}

function keyboardReachable(element: HTMLElement): boolean {
  return !element.hasAttribute('disabled') && element.tabIndex >= 0
}

interface FixtureOptions {
  theme: Theme
  entries?: ReturnType<typeof child>[]
  selectedChildId?: string
  fetchTranscript?: SidechainHistory['fetchTranscript']
  sendPrompt?: SidechainHistory['sendPrompt']
  catalogState?: SidebarSubagentCatalog['state']
}

function fixture(options: FixtureOptions) {
  const labels = getSidechainLabels()
  const sessionFeed = feed({
    current: 'parent', byId: {},
    subagentsByParent: {
      parent: catalog({ entries: options.entries ?? [child('child')], state: options.catalogState ?? 'ready' }),
    },
  })
  const controller: SidechainController = {
    selectChild: vi.fn(), clearStaleSelection: vi.fn(), claimSideChild: vi.fn(() => false),
    deferGenericCandidate: vi.fn(), resetSession: vi.fn(), dispose: vi.fn(),
  }
  const history = {
    fetchTranscript: vi.fn(async () => transcript()),
    fetchActivity: vi.fn(async (_address: SidebarSubagentAddress) => null),
    sendPrompt: vi.fn(async () => true), dispose: vi.fn(),
    ...options,
  } as SidechainHistory
  const scope: SessionScope = { sessionId: 'parent', cwd: '/workspace' }
  const service = { openFile: vi.fn() } as unknown as BetterSidebarService
  const tab = {
    id: 'sidechain', type: 'sidechain', title: 'Sidechain',
    meta: options.selectedChildId === undefined
      ? undefined
      : { version: 1, selectedChildId: options.selectedChildId },
  } as unknown as SidebarTab
  const themeRoot = document.createElement('div')
  themeRoot.dataset.theme = options.theme
  themeRoot.style.setProperty('--dsw-alias-label-primary', options.theme === 'light' ? '#1a1a1a' : '#f5f5f5')
  themeRoot.style.setProperty('--dsw-alias-bg-layer-2', options.theme === 'light' ? '#f4f4f4' : '#25252a')
  themeRoot.style.setProperty('--dsw-alias-interactive-bg-hover', options.theme === 'light' ? '#e8e8e8' : '#34343b')
  document.body.append(themeRoot)
  const mounted = mount(createElement(SidechainView, {
    ctx: { sessions: sessionFeed } as never,
    service,
    scope,
    tab,
    visible: true,
    controller,
    history,
  }))
  themeRoot.append(mounted.container)
  return { ...mounted, themeRoot, sessionFeed, controller, history, service, labels, tab, scope }
}

describe('native Sidechain theme and accessibility guard', () => {
  beforeEach(() => { document.body.innerHTML = '' })
  afterEach(() => { vi.useRealTimers(); document.body.innerHTML = '' })

  it.each(['light', 'dark'] as const)('renders inside the %s theme fixture using normal sidebar geometry', theme => {
    const mounted = fixture({ theme })
    const view = mounted.themeRoot.querySelector<HTMLElement>('[data-sidechain-view]')!
    const descendants = [view, ...view.querySelectorAll<HTMLElement>('*')]
    expect(view).not.toBeNull()
    expect(mounted.themeRoot.dataset.theme).toBe(theme)
    // jsdom does not resolve var() paint values, but it does preserve the
    // fixture's live custom properties for both schemes.
    expect(getComputedStyle(mounted.themeRoot).getPropertyValue('--dsw-alias-label-primary').trim())
      .toBe(theme === 'light' ? '#1a1a1a' : '#f5f5f5')
    expect(view.tagName).not.toBe('ASIDE')
    expect(view.querySelector('aside')).toBeNull()
    expect(getComputedStyle(view).position).not.toBe('fixed')
    expect(['', 'auto']).toContain(getComputedStyle(view).width)
    expect(['', 'auto']).toContain(getComputedStyle(view).zIndex)
    expect(descendants.some(element => getComputedStyle(element).position === 'fixed')).toBe(false)
    expect(descendants.some(element => getComputedStyle(element).zIndex !== '' && getComputedStyle(element).zIndex !== 'auto')).toBe(false)
    unmount(mounted.root, mounted.container)
    mounted.themeRoot.remove()
  })

  it('names and keyboard-enables child selection and the back action', () => {
    const mounted = fixture({ theme: 'light', entries: [child('alpha')] })
    const row = mounted.container.querySelector<HTMLButtonElement>('[data-sidechain-row="alpha"]')!
    expect(row.getAttribute('aria-label')).toBe('alpha')
    expect(keyboardReachable(row)).toBe(true)
    act(() => { row.click() })
    expect(mounted.controller.selectChild).toHaveBeenCalledWith('parent', 'alpha')

    mounted.rerender(createElement(SidechainView, {
      ctx: { sessions: mounted.sessionFeed } as never,
      service: mounted.service,
      scope: mounted.scope,
      tab: { ...mounted.tab, meta: { version: 1, selectedChildId: 'alpha' } },
      visible: true,
      controller: mounted.controller,
      history: mounted.history,
    }))
    const back = mounted.container.querySelector<HTMLButtonElement>('[data-sidechain-back]')!
    expect(back.textContent).toContain(mounted.labels.sidechainBack)
    expect(keyboardReachable(back)).toBe(true)
    act(() => { back.click() })
    expect(mounted.controller.selectChild).toHaveBeenLastCalledWith('parent', undefined)
    unmount(mounted.root, mounted.container)
    mounted.themeRoot.remove()
  })

  it('keeps catalog retry named and keyboard reachable', () => {
    const refreshSubagents = vi.fn()
    const mounted = fixture({ theme: 'dark', catalogState: 'error' })
    const errorSessions = { ...mounted.sessionFeed, refreshSubagents }
    mounted.rerender(createElement(SidechainView, {
      ctx: { sessions: errorSessions } as never,
      service: mounted.service,
      scope: mounted.scope,
      tab: mounted.tab,
      visible: true,
      controller: mounted.controller,
      history: mounted.history,
    }))
    const retry = [...mounted.container.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent === mounted.labels.sidechainRetry)!
    expect(retry).toBeDefined()
    expect(retry.getAttribute('aria-label') ?? retry.textContent).toContain(mounted.labels.sidechainRetry)
    expect(keyboardReachable(retry)).toBe(true)
    act(() => { retry.click() })
    expect(refreshSubagents).toHaveBeenCalledWith('parent')
    unmount(mounted.root, mounted.container)
    mounted.themeRoot.remove()
  })

  it('names and keyboard-enables transcript retry after a read failure', async () => {
    const fetchTranscript = vi.fn().mockRejectedValue(new Error('offline')) as SidechainHistory['fetchTranscript']
    const mounted = fixture({ theme: 'light', selectedChildId: 'child', fetchTranscript })
    await settle()
    const retry = mounted.container.querySelector<HTMLButtonElement>('[data-sidechain-transcript-retry]')!
    expect(retry.textContent).toContain(mounted.labels.sidechainRetry)
    expect(keyboardReachable(retry)).toBe(true)
    act(() => { retry.click() })
    await settle()
    expect(fetchTranscript).toHaveBeenCalledTimes(2)
    unmount(mounted.root, mounted.container)
    mounted.themeRoot.remove()
  })

  it('names and keyboard-enables submit, preserving the real admission path', async () => {
    const sendPrompt = vi.fn(async () => true) as SidechainHistory['sendPrompt']
    const mounted = fixture({ theme: 'dark', selectedChildId: 'child', sendPrompt })
    await settle()
    const input = mounted.container.querySelector<HTMLInputElement>('[data-sidechain-composer-input]')!
    const submit = mounted.container.querySelector<HTMLButtonElement>('[data-sidechain-composer-submit]')!
    expect(input.getAttribute('aria-label')).toBe(mounted.labels.sidechainPromptPlaceholder)
    expect(keyboardReachable(input)).toBe(true)
    expect(submit.getAttribute('aria-label')).toBe(mounted.labels.sidechainSend)
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    act(() => {
      setter?.call(input, 'check keyboard')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(submit.disabled).toBe(false)
    expect(keyboardReachable(submit)).toBe(true)
    act(() => { mounted.container.querySelector<HTMLFormElement>('[data-sidechain-composer]')!.requestSubmit() })
    await settle()
    expect(sendPrompt).toHaveBeenCalledWith(
      { parentSessionId: 'parent', childSessionId: 'child', mode: 'continuable' },
      'check keyboard',
      expect.any(AbortSignal),
    )
    unmount(mounted.root, mounted.container)
    mounted.themeRoot.remove()
  })

  it('exposes produced file mentions as named keyboard-reachable links', async () => {
    const row: TranscriptRow = { kind: 'assistant', seq: 1, text: 'See `src/a.ts`' }
    const fetchTranscript = vi.fn(async () => transcript([row], ['src/a.ts'])) as SidechainHistory['fetchTranscript']
    const mounted = fixture({ theme: 'light', selectedChildId: 'child', fetchTranscript })
    await settle()
    expect(fetchTranscript).toHaveBeenCalled()
    expect(mounted.container.textContent).toContain('See')
    expect([...mounted.container.querySelectorAll('button')].map(button => button.outerHTML).join('\n')).toContain('src/a.ts')
    const link = mounted.container.querySelector<HTMLButtonElement>(
      `button[aria-label="${mounted.labels.sidechainOpenFile}: a.ts"]`,
    )!
    expect(link).not.toBeNull()
    expect(keyboardReachable(link)).toBe(true)
    act(() => { link.click() })
    expect(mounted.service.openFile).toHaveBeenCalledWith(mounted.scope, '/workspace/src/a.ts')
    unmount(mounted.root, mounted.container)
    mounted.themeRoot.remove()
  })
})
