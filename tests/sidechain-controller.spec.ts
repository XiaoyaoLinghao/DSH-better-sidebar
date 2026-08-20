// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import { allLeaves, createSidebarStore, type SidebarStore } from '../src/client/state.ts'
import { createBetterSidebarService, type BetterSidebarService } from '../src/client/service.ts'
import { createSidechainController, parseSidechainMeta } from '../src/client/sidechain/controller.ts'

function makeHarness() {
  const store = createSidebarStore()
  store.setSession('s1')
  const service = createBetterSidebarService(store)
  service.registerTab({ id: 'sidechain', title: 'Sidechain', single: true, component: () => null })
  return { store, service, controller: createSidechainController(service, store) }
}

function sidechainMeta(store: SidebarStore, sessionId = 's1'): unknown {
  const snapshot = store.getSnapshot()
  if (snapshot.sessionId !== sessionId || snapshot.state === undefined) return undefined
  return allLeaves(snapshot.state.splits)
    .concat(allLeaves(snapshot.state.bottomSplits))
    .flatMap(leaf => leaf.tabs)
    .find(tab => tab.type === 'sidechain')?.meta
}

describe('sidechain tab metadata', () => {
  it('accepts only version 1 metadata and drops unknown fields', () => {
    expect(parseSidechainMeta({ version: 1, selectedChildId: 'c1', extra: true }))
      .toEqual({ version: 1, selectedChildId: 'c1' })
    expect(parseSidechainMeta({ version: 2, selectedChildId: 'c1' }))
      .toEqual({ version: 1 })
    expect(parseSidechainMeta(null)).toEqual({ version: 1 })
  })

  it('persists selection per session and clears a stale child only', () => {
    const { store, service, controller } = makeHarness()
    service.openTab({ type: 'sidechain' })
    controller.selectChild('s1', 'c1')
    expect(sidechainMeta(store)).toEqual({ version: 1, selectedChildId: 'c1' })

    store.setSession('s2')
    service.openTab({ type: 'sidechain' })
    controller.selectChild('s2', 'c2')
    expect(sidechainMeta(store, 's2')).toEqual({ version: 1, selectedChildId: 'c2' })
    store.setSession('s1')
    expect(sidechainMeta(store)).toEqual({ version: 1, selectedChildId: 'c1' })

    controller.clearStaleSelection('s1', ['c2'])
    expect(sidechainMeta(store)).toEqual({ version: 1 })
  })
})

describe('sidechain reveal arbitration', () => {
  it('expands and focuses the bottom host when the Sidechain tab lives there', () => {
    const { store, service, controller } = makeHarness()
    service.openTab({ type: 'sidechain' })
    store.update(state => {
      if (state.splits.kind !== 'leaf' || state.bottomSplits.kind !== 'leaf') {
        throw new Error('test fixture must start with one leaf per tree')
      }
      const sidechain = state.splits.tabs.find(tab => tab.type === 'sidechain')
      if (sidechain === undefined) throw new Error('missing sidechain fixture tab')
      state.splits.tabs = state.splits.tabs.filter(tab => tab !== sidechain)
      state.splits.active = null
      state.bottomSplits.tabs.push(sidechain)
      state.bottomSplits.active = sidechain.id
      state.activePane = state.bottomSplits.id
      state.panelOpen = false
      state.bottomOpen = false
    })

    expect(controller.claimSideChild('s1', 'c1')).toBe(true)
    const state = store.getSnapshot().state!
    expect(state.panelOpen).toBe(false)
    expect(state.bottomOpen).toBe(true)
    expect(state.activePane).toBe(state.bottomSplits.kind === 'leaf' ? state.bottomSplits.id : state.activePane)
    expect(state.bottomSplits.kind === 'leaf' ? state.bottomSplits.active : null).toBe('sidechain')
  })

  it('does not repeat reveal side effects for an outstanding duplicate claim', () => {
    const { store, controller } = makeHarness()
    expect(controller.claimSideChild('s1', 'c1')).toBe(true)
    let notifications = 0
    const unsubscribe = store.subscribe(() => { notifications += 1 })

    expect(controller.claimSideChild('s1', 'c1')).toBe(true)
    expect(notifications).toBe(0)
    store.setPrefs({ ...store.getPrefs(), autoOpenSidechain: false })
    notifications = 0
    expect(controller.claimSideChild('s1', 'c1')).toBe(true)
    expect(notifications).toBe(0)
    unsubscribe()
  })

  it('can reveal again after the matching generic candidate consumes a claim', async () => {
    const { store, controller } = makeHarness()
    const generic = vi.fn()
    expect(controller.claimSideChild('s1', 'c1')).toBe(true)
    controller.deferGenericCandidate('s1', 'c1', generic)
    await Promise.resolve()
    expect(generic).not.toHaveBeenCalled()

    let notifications = 0
    const unsubscribe = store.subscribe(() => { notifications += 1 })
    expect(controller.claimSideChild('s1', 'c1')).toBe(true)
    expect(notifications).toBeGreaterThan(0)
    unsubscribe()
  })

  it('consumes a claim only for the same session and child key', async () => {
    const { store, controller } = makeHarness()
    const s2Generic = vi.fn()
    const s1Generic = vi.fn()
    expect(controller.claimSideChild('s1', 'c1')).toBe(true)
    store.setSession('s2')

    controller.deferGenericCandidate('s2', 'c1', s2Generic)
    controller.deferGenericCandidate('s1', 'c1', s1Generic)
    await Promise.resolve()

    expect(s2Generic).toHaveBeenCalledOnce()
    expect(s1Generic).not.toHaveBeenCalled()
  })

  it('suppresses a matching generic candidate when the side claim arrives first', async () => {
    const { controller } = makeHarness()
    const generic = vi.fn()
    expect(controller.claimSideChild('s1', 'c1')).toBe(true)
    controller.deferGenericCandidate('s1', 'c1', generic)
    await Promise.resolve()
    expect(generic).not.toHaveBeenCalled()
  })

  it('suppresses a matching generic candidate when the generic candidate is deferred first', async () => {
    const { controller } = makeHarness()
    const generic = vi.fn()
    controller.deferGenericCandidate('s1', 'c1', generic)
    expect(controller.claimSideChild('s1', 'c1')).toBe(true)
    await Promise.resolve()
    expect(generic).not.toHaveBeenCalled()
  })

  it('does not consume a claim belonging to a different child', async () => {
    const { controller } = makeHarness()
    const generic = vi.fn()
    controller.claimSideChild('s1', 'c1')
    controller.deferGenericCandidate('s1', 'c2', generic)
    await Promise.resolve()
    expect(generic).toHaveBeenCalledOnce()
  })

  it('consumes matching claims exactly once and repeated claims are idempotent', async () => {
    const { controller } = makeHarness()
    const generic = vi.fn()
    expect(controller.claimSideChild('s1', 'c1')).toBe(true)
    expect(controller.claimSideChild('s1', 'c1')).toBe(true)
    controller.deferGenericCandidate('s1', 'c1', generic)
    await Promise.resolve()
    controller.deferGenericCandidate('s1', 'c1', generic)
    await Promise.resolve()
    expect(generic).toHaveBeenCalledOnce()
  })

  it('does not claim or reveal when the descriptor or preference is disabled', async () => {
    const { store, service, controller } = makeHarness()
    service.registerTab({ id: 'other', title: 'Other', component: () => null })
    store.setPrefs({ ...store.getPrefs(), tabsEnabled: { sidechain: false } })
    const generic = vi.fn()
    expect(controller.claimSideChild('s1', 'c1')).toBe(false)
    controller.deferGenericCandidate('s1', 'c1', generic)
    await Promise.resolve()
    expect(generic).toHaveBeenCalledOnce()

    store.setPrefs({ ...store.getPrefs(), tabsEnabled: {}, autoOpenSidechain: false })
    expect(controller.claimSideChild('s1', 'c2')).toBe(false)
  })

  it('clears claims on session reset and disposal', async () => {
    const { controller } = makeHarness()
    const resetCandidate = vi.fn()
    controller.claimSideChild('s1', 'c1')
    controller.resetSession('s1')
    controller.deferGenericCandidate('s1', 'c1', resetCandidate)
    await Promise.resolve()
    expect(resetCandidate).toHaveBeenCalledOnce()

    const disposedCandidate = vi.fn()
    controller.claimSideChild('s1', 'c2')
    controller.dispose()
    controller.deferGenericCandidate('s1', 'c2', disposedCandidate)
    await Promise.resolve()
    expect(disposedCandidate).not.toHaveBeenCalled()
  })
})
