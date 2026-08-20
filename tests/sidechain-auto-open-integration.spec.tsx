// @vitest-environment jsdom
import { StrictMode, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { act } from 'react-dom/test-utils'
import { createRoot, type Root } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { createBetterSidebarService } from '../src/client/service.ts'
import { createSidebarStore } from '../src/client/state.ts'
import { createSidechainController } from '../src/client/sidechain/controller.ts'
import { SidechainCommandObserver } from '../src/client/sidechain/observer.tsx'
import { detectNewDirectSubagent } from '../src/client/subagent-detect.ts'
import type { SidebarSessionList } from '../src/context-types.ts'

function list(parent: string, children: string[]): SidebarSessionList {
  const byId: SidebarSessionList['byId'] = { [parent]: { id: parent, displayTitle: parent } }
  for (const id of children) byId[id] = { id, displayTitle: id, origin: 'subagent', parentId: parent }
  return { current: parent, byId }
}

interface MountedState {
  list: SidebarSessionList
  nodes: readonly never[]
}

/** A minimal real React composition of the observer and generic detector. */
function mountedArbitration(initial: MountedState, observerFirst: boolean, controller: ReturnType<typeof createSidechainController>, onGeneric: () => void) {
  let update!: Dispatch<SetStateAction<MountedState>>
  function GenericDetector({ value }: { value: SidebarSessionList }) {
    const previous = useRef<SidebarSessionList | undefined>(undefined)
    useEffect(() => {
      const prior = previous.current
      previous.current = value
      if (prior === undefined || value.current === undefined) return
      for (const childId of detectNewDirectSubagent(prior, value, value.current)) {
        controller.deferGenericCandidate(value.current, childId, onGeneric)
      }
    }, [controller, onGeneric, value])
    return null
  }
  function Harness() {
    const [value, setValue] = useState(initial)
    update = setValue
    const observer = (
      <SidechainCommandObserver
        controller={controller}
        useSession={(selector) => selector({ sessionId: 'parent', nodes: value.nodes } as never)}
      />
    )
    const generic = <GenericDetector value={value.list} />
    return observerFirst ? <>{observer}{generic}</> : <>{generic}{observer}</>
  }
  const container = document.createElement('div')
  document.body.append(container)
  const root: Root = createRoot(container)
  act(() => { root.render(<StrictMode><Harness /></StrictMode>) })
  return {
    update,
    unmount: () => { act(() => { root.unmount() }); container.remove() },
  }
}

function makeArbitrationHarness() {
  const store = createSidebarStore(); store.setSession('parent')
  const service = createBetterSidebarService(store)
  service.registerTab({ id: 'sidechain', title: 'Sidechain', single: true, component: () => null })
  service.registerTab({ id: 'subagent', title: 'Subagent', single: true, component: () => null })
  return { store, service, controller: createSidechainController(service, store) }
}

const sideChild = '54c34e5e-1c29-4a6c-a2f7-4b19a3d92914'
const otherChild = 'e0f7f7b0-0c3e-4d5f-8c56-6d9f2ab2f6c3'
function command(childId: string): never {
  return {
    kind: 'command', seq: 1, time: Date.now(), commandId: childId,
    name: 'side', args: null,
    outcome: { kind: 'success', text: `Side conversation started: ${childId}.` },
  } as never
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

  it.each([
    ['generic-first', false],
    ['side-first', true],
  ] as const)('mounted %s arrival gives sidechain priority', async (_label, observerFirst) => {
    const { service, controller } = makeArbitrationHarness()
    const generic = vi.fn(() => service.openTab({ type: 'subagent' }))
    const mounted = mountedArbitration({ list: list('parent', []), nodes: [] }, observerFirst, controller, generic)
    act(() => { mounted.update({ list: list('parent', [sideChild]), nodes: [command(sideChild)] }) })
    await Promise.resolve()
    const state = service.getSnapshot().state!
    const tabs = state.splits.kind === 'leaf' ? state.splits.tabs : []
    expect(tabs.some(tab => tab.type === 'sidechain')).toBe(true)
    expect(generic).not.toHaveBeenCalled()
    mounted.unmount(); controller.dispose()
  })

  it('mounted composition keeps different child IDs independent', async () => {
    const { service, controller } = makeArbitrationHarness()
    const generic = vi.fn(() => service.openTab({ type: 'subagent' }))
    const mounted = mountedArbitration({ list: list('parent', []), nodes: [] }, true, controller, generic)
    act(() => { mounted.update({ list: list('parent', [otherChild]), nodes: [command(sideChild)] }) })
    await Promise.resolve()
    const state = service.getSnapshot().state!
    const tabs = state.splits.kind === 'leaf' ? state.splits.tabs : []
    expect(tabs.some(tab => tab.type === 'sidechain')).toBe(true)
    expect(generic).toHaveBeenCalledOnce()
    mounted.unmount(); controller.dispose()
  })

  it('mounted composition falls back to generic when sidechain auto-open is off or disabled', async () => {
    for (const prefs of [
      { autoOpenSidechain: false },
      { tabsEnabled: { sidechain: false } },
    ]) {
      const { store, service, controller } = makeArbitrationHarness()
      store.setPrefs({ ...store.getPrefs(), ...prefs })
      const generic = vi.fn(() => service.openTab({ type: 'subagent' }))
      const mounted = mountedArbitration({ list: list('parent', []), nodes: [] }, true, controller, generic)
      act(() => { mounted.update({ list: list('parent', [sideChild]), nodes: [command(sideChild)] }) })
      await Promise.resolve()
      expect(generic).toHaveBeenCalledOnce()
      mounted.unmount(); controller.dispose()
    }
  })
})
