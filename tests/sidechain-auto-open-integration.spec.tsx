// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { createBetterSidebarService } from '../src/client/service.ts'
import { createSidebarStore } from '../src/client/state.ts'
import { createSidechainController } from '../src/client/sidechain/controller.ts'
import { detectNewDirectSubagent } from '../src/client/subagent-detect.ts'
import type { SidebarSessionList } from '../src/context-types.ts'

function list(parent: string, children: string[]): SidebarSessionList {
  const byId: SidebarSessionList['byId'] = { [parent]: { id: parent, displayTitle: parent } }
  for (const id of children) byId[id] = { id, displayTitle: id, origin: 'subagent', parentId: parent }
  return { current: parent, byId }
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
})
