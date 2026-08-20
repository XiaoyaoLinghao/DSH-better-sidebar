// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
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
import styles from '../src/client/sidechain/SidechainView.module.css'
import { getSidechainLabels } from '../src/client/locales.ts'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

type Theme = 'light' | 'dark'

interface ThemeTokens {
  light: Map<string, string>
  dark: Map<string, string>
}

interface OfficialThemePackage {
  version: string
  clientPath: string
}

function officialThemePackage(): OfficialThemePackage {
  const rootRequire = createRequire(import.meta.url)
  // The theme package is a host-side peer of this directly installed rc.8
  // official UI package. Resolve through its public package exports instead
  // of depending on pnpm's private store layout.
  const conversationPackage = rootRequire.resolve('@deepseek-ai/dsh-client-ui-conversation/package.json')
  const officialRequire = createRequire(conversationPackage)
  const packageJsonPath = officialRequire.resolve('@deepseek-ai/dsh-client-ui-theme/package.json')
  const manifest = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { version?: unknown }
  const clientPath = officialRequire.resolve('@deepseek-ai/dsh-client-ui-theme/client')
  if (typeof manifest.version !== 'string') throw new Error('official rc.8 theme package has no version')
  return { version: manifest.version, clientPath }
}

const OFFICIAL_THEME_PACKAGE = officialThemePackage()
const SIDECHAIN_CSS = readFileSync(resolve('src/client/sidechain/SidechainView.module.css'), 'utf8')

function installedThemeCss(): string {
  const source = readFileSync(OFFICIAL_THEME_PACKAGE.clientPath, 'utf8')
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

interface PaintContract {
  key: keyof typeof styles
  selector: string
  property: string
  token: string
}

const PAINT_CONTRACTS = {
  sidechain: { key: 'sidechain', selector: '.sidechain', property: 'color', token: '--dsw-alias-label-primary' },
  header: { key: 'sidechainHeader', selector: '.sidechainHeader', property: 'border-bottom', token: '--dsw-alias-border-l2' },
  footer: { key: 'sidechainFooter', selector: '.sidechainFooter', property: 'border-top', token: '--dsw-alias-border-l2' },
  composerInput: { key: 'sidechainComposerInput', selector: '.sidechainComposerInput', property: 'border', token: '--dsw-alias-border-l2' },
  composerBackground: { key: 'sidechainComposerInput', selector: '.sidechainComposerInput', property: 'background', token: '--dsw-alias-bg-layer-2' },
  transcript: { key: 'transcript', selector: '.transcript', property: 'color', token: '--dsw-alias-label-primary' },
  assistant: { key: 'assistant', selector: '.assistant', property: 'background', token: '--dsw-alias-interactive-bg-active' },
  user: { key: 'user', selector: '.user', property: 'background', token: '--dsw-alias-bg-layer-2' },
  error: { key: 'sidechainError', selector: '.sidechainError', property: 'color', token: '--dsw-alias-state-error-primary' },
  promptError: { key: 'sidechainPromptError', selector: '.sidechainPromptError', property: 'color', token: '--dsw-alias-state-error-primary' },
} satisfies Record<string, PaintContract>

function sidechainCssReferences(): readonly string[] {
  return [...SIDECHAIN_CSS.matchAll(/var\((--dsw-[\w-]+)/g)].map(match => match[1]!)
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

interface CssRule {
  selectors: readonly string[]
  declarations: Map<string, string>
}

function parseSidechainRules(): readonly CssRule[] {
  const withoutComments = SIDECHAIN_CSS.replace(/\/\*[\s\S]*?\*\//g, '')
  const rules: CssRule[] = []
  for (const match of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const declarations = new Map<string, string>()
    for (const declaration of match[2]!.matchAll(/([\w-]+)\s*:\s*([^;]+)(?:;|$)/g)) {
      declarations.set(declaration[1]!, declaration[2]!.trim())
    }
    rules.push({
      selectors: match[1]!.split(',').map(selector => selector.trim()),
      declarations,
    })
  }
  return rules
}

const SIDECHAIN_RULES = parseSidechainRules()

function cssDeclaration(contract: PaintContract): string {
  const declarations = SIDECHAIN_RULES
    .filter(rule => rule.selectors.includes(contract.selector))
    .map(rule => rule.declarations.get(contract.property))
    .filter((value): value is string => value !== undefined)
    .at(-1)
  if (declarations === undefined) throw new Error(`${contract.selector} has no ${contract.property} declaration`)
  return declarations
}

function assertStylePaint(contract: PaintContract, theme: Theme): void {
  const expectedPaint = resolveThemeToken(contract.token, THEME_TOKENS[theme]).trim().toLowerCase()
  const declaration = cssDeclaration(contract).toLowerCase()
  const referencedToken = declaration.match(/var\((--dsw-[\w-]+)\)/)?.[1]
  if (referencedToken === undefined) throw new Error(`${contract.selector} ${contract.property} has no theme token reference`)
  expect(referencedToken, `${contract.selector} ${contract.property} token reference`).toBe(contract.token)
  const resolved = declaration.replace(/var\((--dsw-[\w-]+)\)/g, (_match, reference: string) =>
    resolveThemeToken(reference, THEME_TOKENS[theme]).trim().toLowerCase())
  const expected = contract.property.startsWith('border') ? `1px solid ${expectedPaint}` : expectedPaint
  expect(resolved, `${contract.selector} ${contract.property} ${theme} style contract`).toBe(expected)
  expect(resolved).not.toContain('var(')
  expect(resolved).not.toContain('transparent')
}

function assertMappedPaint(element: HTMLElement, contract: PaintContract, theme: Theme): void {
  expect(element.classList.contains(styles[contract.key]!), `${contract.selector} DOM class mapping`).toBe(true)
  assertStylePaint(contract, theme)
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
    expect(OFFICIAL_THEME_PACKAGE.version).toBe('0.1.0-rc.8')
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
    assertMappedPaint(view, PAINT_CONTRACTS.sidechain, theme)
    assertMappedPaint(view.children[0] as HTMLElement, PAINT_CONTRACTS.header, theme)
    expect(view.tagName).not.toBe('ASIDE')
    assertNormalGeometry(view)
    unmount(mounted.root, mounted.container)
    mounted.themeRoot.remove()
  })

  it('uses distinct resolved light and dark paints on selected transcript and composer surfaces', async () => {
    const light = fixture({
      theme: 'light', selectedChildId: 'child',
      fetchTranscript: vi.fn(async () => transcript([
        { kind: 'user', seq: 0, text: 'Question' },
        { kind: 'assistant', seq: 1, text: '`src/a.ts`' },
      ], ['src/a.ts'])) as SidechainHistory['fetchTranscript'],
    })
    await settle()
    const lightInput = light.container.querySelector<HTMLInputElement>('[data-sidechain-composer-input]')!
    const lightAssistant = light.container.querySelector<HTMLElement>('[data-transcript-kind="assistant"]')!
    const lightUser = light.container.querySelector<HTMLElement>('[data-transcript-kind="user"]')!
    const lightTranscript = light.container.querySelector<HTMLElement>('[data-transcript-rows]')!
    const lightFooter = light.container.querySelector<HTMLElement>('[data-sidechain-footer]')!
    expect(lightInput).not.toBeNull()
    expect(lightAssistant).not.toBeNull()
    expect(lightUser).not.toBeNull()
    assertMappedPaint(lightInput, PAINT_CONTRACTS.composerInput, 'light')
    assertMappedPaint(lightInput, PAINT_CONTRACTS.composerBackground, 'light')
    assertMappedPaint(lightTranscript, PAINT_CONTRACTS.transcript, 'light')
    assertMappedPaint(lightAssistant, PAINT_CONTRACTS.assistant, 'light')
    assertMappedPaint(lightUser, PAINT_CONTRACTS.user, 'light')
    assertMappedPaint(lightFooter, PAINT_CONTRACTS.footer, 'light')
    const dark = fixture({
      theme: 'dark', selectedChildId: 'child',
      fetchTranscript: vi.fn(async () => transcript([
        { kind: 'user', seq: 0, text: 'Question' },
        { kind: 'assistant', seq: 1, text: '`src/a.ts`' },
      ], ['src/a.ts'])) as SidechainHistory['fetchTranscript'],
    })
    await settle()
    const darkInput = dark.container.querySelector<HTMLInputElement>('[data-sidechain-composer-input]')!
    const darkAssistant = dark.container.querySelector<HTMLElement>('[data-transcript-kind="assistant"]')!
    const darkUser = dark.container.querySelector<HTMLElement>('[data-transcript-kind="user"]')!
    const darkTranscript = dark.container.querySelector<HTMLElement>('[data-transcript-rows]')!
    const darkFooter = dark.container.querySelector<HTMLElement>('[data-sidechain-footer]')!
    expect(darkInput).not.toBeNull()
    expect(darkAssistant).not.toBeNull()
    expect(darkUser).not.toBeNull()
    assertMappedPaint(darkInput, PAINT_CONTRACTS.composerInput, 'dark')
    assertMappedPaint(darkInput, PAINT_CONTRACTS.composerBackground, 'dark')
    assertMappedPaint(darkTranscript, PAINT_CONTRACTS.transcript, 'dark')
    assertMappedPaint(darkAssistant, PAINT_CONTRACTS.assistant, 'dark')
    assertMappedPaint(darkUser, PAINT_CONTRACTS.user, 'dark')
    assertMappedPaint(darkFooter, PAINT_CONTRACTS.footer, 'dark')
    expect(resolveThemeToken('--dsw-alias-label-primary', THEME_TOKENS.light))
      .not.toBe(resolveThemeToken('--dsw-alias-label-primary', THEME_TOKENS.dark))
    expect(resolveThemeToken('--dsw-alias-bg-layer-2', THEME_TOKENS.light))
      .not.toBe(resolveThemeToken('--dsw-alias-bg-layer-2', THEME_TOKENS.dark))
    for (const mounted of [light, dark]) {
      unmount(mounted.root, mounted.container)
      mounted.themeRoot.remove()
    }
  })

  it('names and keyboard-enables child selection and the back action', async () => {
    const mounted = fixture({ theme: 'light', entries: [child('alpha')] })
    const user = userEvent.setup()
    const row = mounted.container.querySelector<HTMLButtonElement>('[data-sidechain-row="alpha"]')!
    expect(row.getAttribute('aria-label')).toBe('alpha')
    expect(keyboardReachable(row)).toBe(true)
    await user.tab()
    await user.tab()
    expect(document.activeElement).toBe(row)
    await user.keyboard('{Enter}')
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
    await user.tab()
    expect(document.activeElement).toBe(back)
    await user.keyboard('{Enter}')
    expect(mounted.controller.selectChild).toHaveBeenLastCalledWith('parent', undefined)
    unmount(mounted.root, mounted.container)
    mounted.themeRoot.remove()
  })

  it('keeps catalog retry named and keyboard reachable', async () => {
    const refreshSubagents = vi.fn()
    const mounted = fixture({ theme: 'dark', catalogState: 'error' })
    const user = userEvent.setup()
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
    assertMappedPaint(mounted.container.querySelector<HTMLElement>('[data-sidechain-error]')!, PAINT_CONTRACTS.error, 'dark')
    const retry = [...mounted.container.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent === mounted.labels.sidechainRetry)!
    expect(retry).toBeDefined()
    expect(retry.getAttribute('aria-label') ?? retry.textContent).toContain(mounted.labels.sidechainRetry)
    expect(keyboardReachable(retry)).toBe(true)
    await user.tab()
    await user.tab()
    expect(document.activeElement).toBe(retry)
    await user.keyboard('[Space]')
    expect(refreshSubagents).toHaveBeenCalledWith('parent')
    unmount(mounted.root, mounted.container)
    mounted.themeRoot.remove()
  })

  it('names and keyboard-enables transcript retry after a read failure', async () => {
    const fetchTranscript = vi.fn().mockRejectedValue(new Error('offline')) as SidechainHistory['fetchTranscript']
    const mounted = fixture({ theme: 'light', selectedChildId: 'child', fetchTranscript })
    const user = userEvent.setup()
    await settle()
    assertNormalGeometry(mounted.container.querySelector<HTMLElement>('[data-sidechain-view]')!)
    assertMappedPaint(mounted.container.querySelector<HTMLElement>('[data-sidechain-transcript-error]')!, PAINT_CONTRACTS.error, 'light')
    const retry = mounted.container.querySelector<HTMLButtonElement>('[data-sidechain-transcript-retry]')!
    expect(retry.textContent).toContain(mounted.labels.sidechainRetry)
    expect(keyboardReachable(retry)).toBe(true)
    await user.tab()
    await user.tab()
    expect(document.activeElement).toBe(retry)
    await user.keyboard('{Enter}')
    await settle()
    expect(fetchTranscript).toHaveBeenCalledTimes(2)
    unmount(mounted.root, mounted.container)
    mounted.themeRoot.remove()
  })

  it('names and keyboard-enables submit, preserving the real admission path', async () => {
    const sendPrompt = vi.fn<SidechainHistory['sendPrompt']>(async () => true)
    const mounted = fixture({ theme: 'dark', selectedChildId: 'child', sendPrompt })
    const user = userEvent.setup()
    await settle()
    assertNormalGeometry(mounted.container.querySelector<HTMLElement>('[data-sidechain-view]')!)
    const input = mounted.container.querySelector<HTMLInputElement>('[data-sidechain-composer-input]')!
    const submit = mounted.container.querySelector<HTMLButtonElement>('[data-sidechain-composer-submit]')!
    expect(input.getAttribute('aria-label')).toBe(mounted.labels.sidechainPromptPlaceholder)
    expect(keyboardReachable(input)).toBe(true)
    expect(submit.getAttribute('aria-label')).toBe(mounted.labels.sidechainSend)
    await user.tab()
    await user.tab()
    expect(document.activeElement).toBe(input)
    await user.type(input, 'check keyboard')
    expect(submit.disabled).toBe(false)
    expect(keyboardReachable(submit)).toBe(true)
    await user.keyboard('{Enter}')
    await settle()
    expect(sendPrompt).toHaveBeenCalledWith(
      { parentSessionId: 'parent', childSessionId: 'child', mode: 'continuable' },
      'check keyboard',
      expect.any(AbortSignal),
    )
    sendPrompt.mockResolvedValue(false)
    await user.type(input, 'failure')
    await user.keyboard('{Enter}')
    await settle()
    const promptError = mounted.container.querySelector<HTMLElement>('[data-sidechain-composer] [role="alert"]')!
    expect(promptError).not.toBeNull()
    assertMappedPaint(promptError, PAINT_CONTRACTS.promptError, 'dark')
    unmount(mounted.root, mounted.container)
    mounted.themeRoot.remove()
  })

  it('exposes produced file mentions as named keyboard-reachable links', async () => {
    const row: TranscriptRow = { kind: 'assistant', seq: 1, text: 'See `src/a.ts`' }
    const fetchTranscript = vi.fn(async () => transcript([row], ['src/a.ts'])) as SidechainHistory['fetchTranscript']
    const mounted = fixture({ theme: 'light', selectedChildId: 'child', fetchTranscript })
    const user = userEvent.setup()
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
    await user.tab()
    await user.tab()
    expect(document.activeElement).toBe(link)
    await user.keyboard('{Enter}')
    expect(mounted.service.openFile).toHaveBeenCalledWith(mounted.scope, '/workspace/src/a.ts')
    unmount(mounted.root, mounted.container)
    mounted.themeRoot.remove()
  })
})
