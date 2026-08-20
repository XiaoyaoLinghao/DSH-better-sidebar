// @vitest-environment jsdom
import { StrictMode, createElement, useState, type ComponentType, type Dispatch, type SetStateAction } from 'react'
import { act } from 'react-dom/test-utils'
import { createRoot, type Root } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import type { Context } from '../src/context-types.ts'
import { Sidebar } from '../src/client/Sidebar.tsx'
import { createBetterSidebarService } from '../src/client/service.ts'
import { createSidebarStore } from '../src/client/state.ts'
import { createSidechainController } from '../src/client/sidechain/controller.ts'
import { createSidechainClientRuntime } from '../src/client/sidechain/index.tsx'
import { detectNewDirectSubagent } from '../src/client/subagent-detect.ts'
import type { SidebarSessionList } from '../src/context-types.ts'

class FakeWebSocket {
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  constructor(_url: string) {}
  close(): void {}
}

function list(parent: string, children: string[]): SidebarSessionList {
  const byId: SidebarSessionList['byId'] = { [parent]: { id: parent, displayTitle: parent, cwd: '/tmp' } }
  for (const id of children) byId[id] = { id, displayTitle: id, origin: 'subagent', parentId: parent, cwd: '/tmp' }
  return { current: parent, byId }
}

function command(childId: string, time = Date.now()): never {
  return {
    kind: 'command', seq: 1, time, commandId: childId,
    name: 'side', args: null,
    outcome: { kind: 'success', text: `Side conversation started: ${childId}.` },
  } as never
}

const sideChild = '54c34e5e-1c29-4a6c-a2f7-4b19a3d92914'
const otherChild = 'e0f7f7b0-0c3e-4d5f-8c56-6d9f2ab2f6c3'

interface RuntimeFixture {
  store: ReturnType<typeof createSidebarStore>
  service: ReturnType<typeof createBetterSidebarService>
  runtime: ReturnType<typeof createSidechainClientRuntime>
  updateList: (value: SidebarSessionList) => void
  updateConversation: Dispatch<SetStateAction<{ sessionId: string; nodes: readonly never[] }>>
  unmount: () => void
}

function tabsOf(fixture: RuntimeFixture) {
  const state = fixture.service.getSnapshot().state
  return state?.splits.kind === 'leaf' ? state.splits.tabs : []
}

/** Production composition: source Sidebar plus the observer registered by the source runtime. */
function mountRealArbitration(observerFirst: boolean, initialChildren: string[] = []): RuntimeFixture {
  vi.stubGlobal('WebSocket', FakeWebSocket)
  const store = createSidebarStore()
  store.setSession('parent')
  store.setPrefs({ ...store.getPrefs(), openByDefault: true, autoOpenSubagent: true, autoOpenSidechain: true })
  const service = createBetterSidebarService(store)
  service.registerTab({ id: 'sidechain', title: 'Sidechain', single: true, component: () => null })
  service.registerTab({ id: 'subagent', title: 'Subagent', single: true, component: () => null })

  let sessionList = list('parent', initialChildren)
  const sessionListeners = new Set<() => void>()
  const locale = { active: 'en' }
  const slots = new Map<string, { component: unknown; dispose: () => void }>()
  const ctx = {
    locale: { getSnapshot: () => locale, subscribe: () => () => {} },
    sessions: {
      list: {
        getSnapshot: () => sessionList,
        subscribe: (listener: () => void) => { sessionListeners.add(listener); return () => sessionListeners.delete(listener) },
      },
    },
    slots: {
      inject: (_name: string, callback: () => () => void) => callback(),
      register: (options: Record<string, unknown>, component: unknown) => {
        const key = String(options.id ?? options.key)
        const entry = { component, dispose: () => { slots.delete(key) } }
        slots.set(key, entry)
        return entry.dispose
      },
    },
    connection: { api: { subagents: { history: vi.fn(), prompt: vi.fn() } } },
    betterSidebar: service,
  } as unknown as Context
  const runtime = createSidechainClientRuntime(ctx, service, store)
  const observerEntry = slots.get('sidechain-command-observer')
  if (observerEntry === undefined) throw new Error('runtime did not register observer')
  const Observer = observerEntry.component as ComponentType<{
    useSession: <S>(selector: (snapshot: { sessionId: string; nodes: readonly never[] }) => S) => S
  }>
  let updateConversation!: Dispatch<SetStateAction<{ sessionId: string; nodes: readonly never[] }>>
  function ConversationObserver() {
    const [snapshot, setSnapshot] = useState<{ sessionId: string; nodes: readonly never[] }>({ sessionId: 'parent', nodes: [] })
    updateConversation = setSnapshot
    return createElement(Observer, { useSession: selector => selector(snapshot) })
  }
  const container = document.createElement('div')
  document.body.append(container)
  const root: Root = createRoot(container)
  const sidebar = createElement(Sidebar, { ctx, store, controller: runtime.controller })
  const observer = createElement(ConversationObserver)
  act(() => { root.render(<StrictMode>{observerFirst ? <>{observer}{sidebar}</> : <>{sidebar}{observer}</>}</StrictMode>) })
  const updateList = (value: SidebarSessionList): void => {
    sessionList = value
    act(() => { for (const listener of sessionListeners) listener() })
  }
  return {
    store, service, runtime, updateList, updateConversation,
    unmount: () => {
      act(() => { root.unmount() })
      runtime.dispose()
      container.remove()
      vi.unstubAllGlobals()
    },
  }
}

describe('generic and sidechain auto-open arbitration', () => {
  it('returns exact newly appeared direct child IDs, including later children', () => {
    expect(detectNewDirectSubagent(list('p', ['a']), list('p', ['a', 'b']), 'p')).toEqual(['b'])
    expect(detectNewDirectSubagent(list('p', []), list('p', ['a', 'b']), 'p')).toEqual(['a', 'b'])
  })

  it('suppresses only the matching generic child regardless of arrival order', async () => {
    const store = createSidebarStore(); store.setSession('p')
    const service = createBetterSidebarService(store)
    service.registerTab({ id: 'sidechain', title: 'Sidechain', component: () => null })
    const controller = createSidechainController(service, store)
    const generic = vi.fn()
    controller.deferGenericCandidate('p', 'side', generic)
    controller.claimSideChild('p', 'side')
    controller.deferGenericCandidate('p', 'other', generic)
    await Promise.resolve()
    expect(generic).toHaveBeenCalledOnce()
    controller.dispose()
  })

  it('does not let disabled sidechain claim suppress generic auto-open', async () => {
    const store = createSidebarStore(); store.setSession('p')
    const service = createBetterSidebarService(store)
    service.registerTab({ id: 'sidechain', title: 'Sidechain', component: () => null })
    store.setPrefs({ ...store.getPrefs(), tabsEnabled: { sidechain: false } })
    const controller = createSidechainController(service, store)
    const generic = vi.fn()
    expect(controller.claimSideChild('p', 'side')).toBe(false)
    controller.deferGenericCandidate('p', 'side', generic)
    await Promise.resolve()
    expect(generic).toHaveBeenCalledOnce()
  })

  it.each([['generic-first', false], ['side-first', true]] as const)('real Sidebar/runtime composition uses one controller (%s)', async (_label, observerFirst) => {
    const fixture = mountRealArbitration(observerFirst)
    const defer = vi.spyOn(fixture.runtime.controller, 'deferGenericCandidate')
    const claim = vi.spyOn(fixture.runtime.controller, 'claimSideChild')
    act(() => {
      fixture.updateList(list('parent', [sideChild]))
      fixture.updateConversation({ sessionId: 'parent', nodes: [command(sideChild)] })
    })
    await Promise.resolve()
    expect(defer).toHaveBeenCalledWith('parent', sideChild, expect.any(Function))
    expect(claim).toHaveBeenCalledWith('parent', sideChild)
    const tabs = tabsOf(fixture)
    expect(tabs.some(tab => tab.type === 'sidechain')).toBe(true)
    expect(tabs.some(tab => tab.type === 'subagent')).toBe(false)
    fixture.unmount()
  })

  it('real Sidebar processes every newly appeared direct child by exact ID', () => {
    const fixture = mountRealArbitration(true)
    const defer = vi.spyOn(fixture.runtime.controller, 'deferGenericCandidate')
    act(() => { fixture.updateList(list('parent', [sideChild, otherChild])) })
    expect(defer).toHaveBeenNthCalledWith(1, 'parent', sideChild, expect.any(Function))
    expect(defer).toHaveBeenNthCalledWith(2, 'parent', otherChild, expect.any(Function))
    fixture.unmount()
  })

  it('keeps different child IDs independent in the real composition', async () => {
    const fixture = mountRealArbitration(true)
    const claim = vi.spyOn(fixture.runtime.controller, 'claimSideChild')
    act(() => {
      fixture.updateList(list('parent', [otherChild]))
      fixture.updateConversation({ sessionId: 'parent', nodes: [command(sideChild)] })
    })
    await Promise.resolve()
    expect(claim).toHaveBeenCalledWith('parent', sideChild)
    const tabs = tabsOf(fixture)
    expect(tabs.some(tab => tab.type === 'sidechain')).toBe(true)
    expect(tabs.some(tab => tab.type === 'subagent')).toBe(true)
    fixture.unmount()
  })

  it('falls back to generic when sidechain auto-open is off or disabled', async () => {
    for (const prefs of [{ autoOpenSidechain: false }, { tabsEnabled: { sidechain: false } }]) {
      const fixture = mountRealArbitration(true)
      fixture.store.setPrefs({ ...fixture.store.getPrefs(), ...prefs })
      act(() => {
        fixture.updateList(list('parent', [sideChild]))
        fixture.updateConversation({ sessionId: 'parent', nodes: [command(sideChild)] })
      })
      await Promise.resolve()
      const tabs = tabsOf(fixture)
      expect(tabs.some(tab => tab.type === 'subagent')).toBe(true)
      fixture.unmount()
    }
  })

  it('invalidates queued old-session candidates on reset and dispose', async () => {
    const fixture = mountRealArbitration(true)
    const defer = vi.spyOn(fixture.runtime.controller, 'deferGenericCandidate')
    const reset = vi.spyOn(fixture.runtime.controller, 'resetSession')
    act(() => { fixture.updateList(list('parent', [sideChild])) })
    expect(defer).toHaveBeenCalledWith('parent', sideChild, expect.any(Function))
    act(() => {
      fixture.updateList(list('new-session', []))
      fixture.updateConversation({ sessionId: 'new-session', nodes: [] })
    })
    await Promise.resolve()
    expect(reset).toHaveBeenCalledWith('parent')
    expect(reset).toHaveBeenCalledWith('new-session')
    const tabs = tabsOf(fixture)
    expect(tabs.some(tab => tab.type === 'subagent')).toBe(false)
    fixture.unmount()
  })

  it('does not claim after unmount before the committed observer effect', async () => {
    const fixture = mountRealArbitration(true)
    const claim = vi.spyOn(fixture.runtime.controller, 'claimSideChild')
    // A concurrent root can have a queued snapshot render which has not
    // committed its observer effect yet. Unmount immediately, before React's
    // scheduler gets a chance to run that effect.
    fixture.updateConversation({ sessionId: 'parent', nodes: [command(sideChild)] })
    fixture.unmount()
    await Promise.resolve()
    expect(claim).not.toHaveBeenCalledWith('parent', sideChild)
  })

  it('runtime dispose cancels a real Sidebar candidate queued before disposal', async () => {
    const fixture = mountRealArbitration(true)
    const defer = vi.spyOn(fixture.runtime.controller, 'deferGenericCandidate')
    act(() => { fixture.updateList(list('parent', [sideChild])) })
    expect(defer).toHaveBeenCalledWith('parent', sideChild, expect.any(Function))
    fixture.runtime.dispose()
    await Promise.resolve()
    expect(tabsOf(fixture).some(tab => tab.type === 'subagent')).toBe(false)
    fixture.unmount()
  })
})
