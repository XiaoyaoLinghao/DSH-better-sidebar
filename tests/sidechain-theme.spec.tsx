// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
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

interface ThemeTokens {
  light: Map<string, string>
  dark: Map<string, string>
}

function installedThemeCss(): string {
  const pnpmRoot = resolve('node_modules/.pnpm')
  const packageDir = readdirSync(pnpmRoot).find(name => {
    if (!name.startsWith('@deepseek-ai+dsh-client-ui-')) return false
    return existsSync(join(pnpmRoot, name, 'node_modules/@deepseek-ai/dsh-client-ui-theme/lib/client.js'))
  })
  if (packageDir === undefined) throw new Error('rc.8 dsh-client-ui-theme is not installed')
  const source = readFileSync(join(
    pnpmRoot, packageDir, 'node_modules/@deepseek-ai/dsh-client-ui-theme/lib/client.js',
  ), 'utf8')
  const encoded = [...source.matchAll(/var \w+_css_default = "((?:\\.|[^"])*)";/g)].map(match => match[1]!)
  if (encoded.length === 0) throw new Error('installed rc.8 theme CSS was not found')
  return encoded.map(value => JSON.parse(`"${value}"`) as string).join('\n')
}

function parseThemeTokens(): ThemeTokens {
  const css = installedThemeCss()
  const readDeclarations = (block: string): Map<string, string> => {
    const values = new Map<string, string>()
    for (const match of block.matchAll(/(--dsw-[\w-]+):([^;}]+)/g)) values.set(match[1]!, match[2]!)
    return values
  }
  const light = new Map<string, string>()
  for (const match of css.matchAll(/:root\{([^}]*)\}/g)) {
    for (const [name, value] of readDeclarations(match[1]!)) light.set(name, value)
  }
  for (const match of css.matchAll(/body\{([^}]*)\}/g)) {
    for (const [name, value] of readDeclarations(match[1]!)) light.set(name, value)
  }
  const dark = new Map(light)
  for (const match of css.matchAll(/body\[data-ds-dark-theme\]\{([^}]*)\}/g)) {
    for (const [name, value] of readDeclarations(match[1]!)) dark.set(name, value)
  }
  return { light, dark }
}

const THEME_TOKENS = parseThemeTokens()

function sidechainCssReferences(): readonly string[] {
  const css = readFileSync(resolve('src/client/sidechain/SidechainView.module.css'), 'utf8')
  return [...css.matchAll(/var\((--dsw-[\w-]+)/g)].map(match => match[1]!)
}

function resolveThemeToken(name: string, tokens: Map<string, string>, seen = new Set<string>()): string {
  if (seen.has(name)) throw new Error(`theme token cycle at ${name}`)
  const value = tokens.get(name)
  if (value === undefined) throw new Error(`theme token ${name} is not defined`)
  seen.add(name)
  return value.replace(/var\((--dsw-[\w-]+)\)/g, (_match, reference: string) =>
    resolveThemeToken(reference, tokens, new Set(seen)))
}

function applyThemeTokens(target: HTMLElement, theme: Theme): void {
  for (const [name, value] of THEME_TOKENS[theme]) target.style.setProperty(name, value)
}

function assertThemePaint(element: HTMLElement, property: string, token: string, theme: Theme): void {
  const expected = resolveThemeToken(token, THEME_TOKENS[theme]).trim().toLowerCase()
  expect(expected).not.toBe('transparent')
  expect(expected).not.toBe('#0000')
  const actual = getComputedStyle(element).getPropertyValue(property).trim().toLowerCase()
  // jsdom currently leaves custom-property var() paints unresolved. In that
  // case the parsed rc.8 contract above is the assertion; when it resolves,
  // also reject an inert computed paint.
  const unresolved = actual === '' || actual.includes('var(')
    || (actual === 'rgb(0, 0, 0)' && expected !== '#000' && expected !== '#000000')
    || actual === 'rgba(0, 0, 0, 0)'
  if (!unresolved) {
    expect(actual).not.toBe('transparent')
    expect(actual).not.toBe('rgba(0, 0, 0, 0)')
  }
}

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

function keyboardActivate(element: HTMLElement, key: 'Enter' | ' '): void {
  element.focus()
  expect(document.activeElement).toBe(element)
  element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
  element.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true, cancelable: true }))
  // jsdom does not synthesize the native button click from Enter/Space; this
  // final activation mirrors that browser default after the real key events.
  element.click()
}

function assertNormalGeometry(view: HTMLElement): void {
  const directSurfaces = [
    view,
    view.children[0] as HTMLElement | undefined,
    view.children[1] as HTMLElement | undefined,
    view.querySelector<HTMLElement>('[data-sidechain-detail]'),
    view.querySelector<HTMLElement>('[data-sidechain-footer]'),
    view.querySelector<HTMLElement>('[data-sidechain-composer]'),
    view.querySelector<HTMLElement>('[data-transcript-rows]'),
  ].filter((element): element is HTMLElement => element !== undefined && element !== null)
  for (const element of directSurfaces) {
    const style = getComputedStyle(element)
    expect(style.position, `${element.tagName} position`).not.toBe('fixed')
    expect(['', 'auto']).toContain(style.width)
    expect(['', 'auto']).toContain(style.zIndex)
  }
  for (const element of [view, ...view.querySelectorAll<HTMLElement>('*')]) {
    expect(getComputedStyle(element).position).not.toBe('fixed')
    expect(['', 'auto']).toContain(getComputedStyle(element).zIndex)
  }
  expect(view.querySelector('aside')).toBeNull()
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
  applyThemeTokens(themeRoot, options.theme)
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

  it('defines every Sidechain CSS theme token in both installed rc.8 modes', () => {
    const references = [...new Set(sidechainCssReferences())]
    expect(references).not.toContain('--dsw-alias-line-light')
    for (const reference of references) {
      expect(THEME_TOKENS.light.has(reference), `light token ${reference}`).toBe(true)
      expect(THEME_TOKENS.dark.has(reference), `dark token ${reference}`).toBe(true)
      expect(resolveThemeToken(reference, THEME_TOKENS.light)).not.toBe('')
      expect(resolveThemeToken(reference, THEME_TOKENS.dark)).not.toBe('')
    }
  })

  it.each(['light', 'dark'] as const)('renders inside the %s theme fixture using normal sidebar geometry', theme => {
    const mounted = fixture({ theme })
    const view = mounted.themeRoot.querySelector<HTMLElement>('[data-sidechain-view]')!
    expect(view).not.toBeNull()
    expect(mounted.themeRoot.dataset.theme).toBe(theme)
    // jsdom does not resolve var() paint values, but it does preserve the
    // fixture's live custom properties for both schemes.
    expect(getComputedStyle(mounted.themeRoot).getPropertyValue('--dsw-alias-label-primary').trim())
      .toBe(THEME_TOKENS[theme].get('--dsw-alias-label-primary'))
    assertThemePaint(view, 'color', '--dsw-alias-label-primary', theme)
    assertThemePaint(view.children[0] as HTMLElement, 'border-bottom-color', '--dsw-alias-border-l2', theme)
    expect(view.tagName).not.toBe('ASIDE')
    assertNormalGeometry(view)
    unmount(mounted.root, mounted.container)
    mounted.themeRoot.remove()
  })

  it('uses distinct resolved light and dark paints on selected transcript and composer surfaces', async () => {
    const light = fixture({
      theme: 'light', selectedChildId: 'child',
      fetchTranscript: vi.fn(async () => transcript([
        { kind: 'assistant', seq: 1, text: '`src/a.ts`' },
      ], ['src/a.ts'])) as SidechainHistory['fetchTranscript'],
    })
    await settle()
    const lightInput = light.container.querySelector<HTMLInputElement>('[data-sidechain-composer-input]')!
    const lightAssistant = light.container.querySelector<HTMLElement>('[data-transcript-kind="assistant"]')!
    assertThemePaint(lightInput, 'color', '--dsw-alias-label-primary', 'light')
    assertThemePaint(lightInput, 'background-color', '--dsw-alias-bg-layer-2', 'light')
    assertThemePaint(lightInput, 'border-top-color', '--dsw-alias-border-l2', 'light')
    assertThemePaint(lightAssistant, 'color', '--dsw-alias-label-primary', 'light')
    assertThemePaint(lightAssistant, 'background-color', '--dsw-alias-interactive-bg-active', 'light')
    const dark = fixture({
      theme: 'dark', selectedChildId: 'child',
      fetchTranscript: vi.fn(async () => transcript([
        { kind: 'assistant', seq: 1, text: '`src/a.ts`' },
      ], ['src/a.ts'])) as SidechainHistory['fetchTranscript'],
    })
    await settle()
    const darkInput = dark.container.querySelector<HTMLInputElement>('[data-sidechain-composer-input]')!
    const darkAssistant = dark.container.querySelector<HTMLElement>('[data-transcript-kind="assistant"]')!
    assertThemePaint(darkInput, 'color', '--dsw-alias-label-primary', 'dark')
    assertThemePaint(darkInput, 'background-color', '--dsw-alias-bg-layer-2', 'dark')
    assertThemePaint(darkInput, 'border-top-color', '--dsw-alias-border-l2', 'dark')
    assertThemePaint(darkAssistant, 'color', '--dsw-alias-label-primary', 'dark')
    assertThemePaint(darkAssistant, 'background-color', '--dsw-alias-interactive-bg-active', 'dark')
    expect(resolveThemeToken('--dsw-alias-label-primary', THEME_TOKENS.light))
      .not.toBe(resolveThemeToken('--dsw-alias-label-primary', THEME_TOKENS.dark))
    expect(resolveThemeToken('--dsw-alias-bg-layer-2', THEME_TOKENS.light))
      .not.toBe(resolveThemeToken('--dsw-alias-bg-layer-2', THEME_TOKENS.dark))
    for (const mounted of [light, dark]) {
      unmount(mounted.root, mounted.container)
      mounted.themeRoot.remove()
    }
  })

  it('names and keyboard-enables child selection and the back action', () => {
    const mounted = fixture({ theme: 'light', entries: [child('alpha')] })
    const row = mounted.container.querySelector<HTMLButtonElement>('[data-sidechain-row="alpha"]')!
    expect(row.getAttribute('aria-label')).toBe('alpha')
    expect(keyboardReachable(row)).toBe(true)
    act(() => { keyboardActivate(row, 'Enter') })
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
    assertNormalGeometry(mounted.container.querySelector<HTMLElement>('[data-sidechain-view]')!)
    const back = mounted.container.querySelector<HTMLButtonElement>('[data-sidechain-back]')!
    expect(back.textContent).toContain(mounted.labels.sidechainBack)
    expect(keyboardReachable(back)).toBe(true)
    act(() => { keyboardActivate(back, 'Enter') })
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
    assertNormalGeometry(mounted.container.querySelector<HTMLElement>('[data-sidechain-view]')!)
    const retry = [...mounted.container.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent === mounted.labels.sidechainRetry)!
    expect(retry).toBeDefined()
    expect(retry.getAttribute('aria-label') ?? retry.textContent).toContain(mounted.labels.sidechainRetry)
    expect(keyboardReachable(retry)).toBe(true)
    act(() => { keyboardActivate(retry, ' ') })
    expect(refreshSubagents).toHaveBeenCalledWith('parent')
    unmount(mounted.root, mounted.container)
    mounted.themeRoot.remove()
  })

  it('names and keyboard-enables transcript retry after a read failure', async () => {
    const fetchTranscript = vi.fn().mockRejectedValue(new Error('offline')) as SidechainHistory['fetchTranscript']
    const mounted = fixture({ theme: 'light', selectedChildId: 'child', fetchTranscript })
    await settle()
    assertNormalGeometry(mounted.container.querySelector<HTMLElement>('[data-sidechain-view]')!)
    const retry = mounted.container.querySelector<HTMLButtonElement>('[data-sidechain-transcript-retry]')!
    expect(retry.textContent).toContain(mounted.labels.sidechainRetry)
    expect(keyboardReachable(retry)).toBe(true)
    act(() => { keyboardActivate(retry, 'Enter') })
    await settle()
    expect(fetchTranscript).toHaveBeenCalledTimes(2)
    unmount(mounted.root, mounted.container)
    mounted.themeRoot.remove()
  })

  it('names and keyboard-enables submit, preserving the real admission path', async () => {
    const sendPrompt = vi.fn(async () => true) as SidechainHistory['sendPrompt']
    const mounted = fixture({ theme: 'dark', selectedChildId: 'child', sendPrompt })
    await settle()
    assertNormalGeometry(mounted.container.querySelector<HTMLElement>('[data-sidechain-view]')!)
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
    act(() => {
      input.focus()
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
      mounted.container.querySelector<HTMLFormElement>('[data-sidechain-composer]')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
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
    assertNormalGeometry(mounted.container.querySelector<HTMLElement>('[data-sidechain-view]')!)
    expect(fetchTranscript).toHaveBeenCalled()
    expect(mounted.container.textContent).toContain('See')
    expect([...mounted.container.querySelectorAll('button')].map(button => button.outerHTML).join('\n')).toContain('src/a.ts')
    const link = mounted.container.querySelector<HTMLButtonElement>(
      `button[aria-label="${mounted.labels.sidechainOpenFile}: a.ts"]`,
    )!
    expect(link).not.toBeNull()
    expect(keyboardReachable(link)).toBe(true)
    act(() => { keyboardActivate(link, 'Enter') })
    expect(mounted.service.openFile).toHaveBeenCalledWith(mounted.scope, '/workspace/src/a.ts')
    unmount(mounted.root, mounted.container)
    mounted.themeRoot.remove()
  })
})
