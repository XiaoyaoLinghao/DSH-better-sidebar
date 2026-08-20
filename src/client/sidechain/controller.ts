import {
  allLeaves,
  firstLeaf,
  patchTab,
  type SidebarState,
  type SidebarStore,
  type SidebarTab,
} from '../state.ts'
import type { BetterSidebarService } from '../service.ts'

/** The durable, intentionally small state owned by the Sidechain tab. */
export interface SidechainTabMetaV1 {
  version: 1
  selectedChildId?: string
}

/** Parse persisted metadata without allowing unknown or future fields through. */
export function parseSidechainMeta(value: unknown): SidechainTabMetaV1 {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { version: 1 }
  }
  const record = value as Record<string, unknown>
  if (record.version !== 1) return { version: 1 }
  return typeof record.selectedChildId === 'string'
    ? { version: 1, selectedChildId: record.selectedChildId }
    : { version: 1 }
}

export interface SidechainController {
  selectChild(sessionId: string, childId?: string): void
  clearStaleSelection(sessionId: string, liveChildIds: readonly string[]): void
  claimSideChild(sessionId: string, childId: string): boolean
  deferGenericCandidate(sessionId: string, childId: string, open: () => void): void
  resetSession(sessionId: string): void
  dispose(): void
}

const SIDECHAIN_TAB_ID = 'sidechain'

/**
 * Coordinate Sidechain's durable selection and the generic Subagent
 * auto-open path. The controller deliberately owns no React state or timers.
 */
export function createSidechainController(
  service: BetterSidebarService,
  store: SidebarStore,
): SidechainController {
  const claims = new Map<string, Set<string>>()
  let disposed = false

  const sidechainTab = (state: SidebarState): SidebarTab | undefined => {
    return allLeaves(state.splits)
      .concat(allLeaves(state.bottomSplits))
      .flatMap(leaf => leaf.tabs)
      .find(tab => tab.type === SIDECHAIN_TAB_ID)
  }

  const updateSession = (sessionId: string, update: (state: SidebarState) => SidebarState): void => {
    if (store.getSnapshot().sessionId === sessionId) store.reduce(update)
    else store.reduceFor(sessionId, update)
  }

  const metadataFor = (childId?: string): SidechainTabMetaV1 => childId === undefined
    ? { version: 1 }
    : { version: 1, selectedChildId: childId }

  const sameMeta = (a: SidechainTabMetaV1, b: SidechainTabMetaV1): boolean => {
    return a.version === b.version && a.selectedChildId === b.selectedChildId
  }

  const selectChild = (sessionId: string, childId?: string): void => {
    const nextMeta = metadataFor(childId)
    updateSession(sessionId, (state) => {
      const tab = sidechainTab(state)
      if (tab === undefined) return state
      // Keep persisted metadata canonical, including when a hydrated tab had
      // unknown fields or a future version.
      if (sameMeta(parseSidechainMeta(tab.meta), nextMeta)
        && isCanonicalMeta(tab.meta, nextMeta)) {
        return state
      }
      return patchTab(state, tab.id, { meta: nextMeta })
    })
  }

  const clearStaleSelection = (sessionId: string, liveChildIds: readonly string[]): void => {
    const live = new Set(liveChildIds)
    updateSession(sessionId, (state) => {
      const tab = sidechainTab(state)
      if (tab === undefined) return state
      const current = parseSidechainMeta(tab.meta)
      if (current.selectedChildId !== undefined && live.has(current.selectedChildId)) {
        return isCanonicalMeta(tab.meta, current) ? state : patchTab(state, tab.id, { meta: current })
      }
      const empty = { version: 1 } as const
      if (sameMeta(current, empty) && isCanonicalMeta(tab.meta, empty)) return state
      return patchTab(state, tab.id, { meta: empty })
    })
  }

  const enabled = (): boolean => {
    return !disposed
      && service.getTab(SIDECHAIN_TAB_ID) !== undefined
      && service.isTabEnabled(SIDECHAIN_TAB_ID)
      && store.getPrefs().autoOpenSidechain
  }

  const reveal = (sessionId: string, childId: string): void => {
    // Auto-open behavior belongs to the owning right panel. A targeted open
    // into an inactive session still persists there, but must not move the
    // currently visible session's panel.
    if (store.getSnapshot().sessionId === sessionId) {
      store.reduce(state => state.panelOpen ? state : { ...state, panelOpen: true })
      store.reduce(state => ({ ...state, activePane: firstLeaf(state.splits).id }))
    }
    service.openTab(
      { type: SIDECHAIN_TAB_ID, meta: metadataFor(childId) },
      { sessionId },
    )
    // `openTab` seeds metadata only for a newly minted tab; patch an existing
    // single tab as well so focus and selection are one synchronous action.
    selectChild(sessionId, childId)
  }

  const claimSideChild = (sessionId: string, childId: string): boolean => {
    if (!enabled()) return false
    let sessionClaims = claims.get(sessionId)
    if (sessionClaims === undefined) {
      sessionClaims = new Set<string>()
      claims.set(sessionId, sessionClaims)
    }
    sessionClaims.add(childId)
    reveal(sessionId, childId)
    return true
  }

  const deferGenericCandidate = (sessionId: string, childId: string, open: () => void): void => {
    if (disposed) return
    queueMicrotask(() => {
      if (disposed) return
      const sessionClaims = claims.get(sessionId)
      if (sessionClaims?.delete(childId)) {
        if (sessionClaims.size === 0) claims.delete(sessionId)
        return
      }
      open()
    })
  }

  const resetSession = (sessionId: string): void => {
    claims.delete(sessionId)
  }

  const dispose = (): void => {
    disposed = true
    claims.clear()
  }

  return {
    selectChild,
    clearStaleSelection,
    claimSideChild,
    deferGenericCandidate,
    resetSession,
    dispose,
  }
}

function isCanonicalMeta(value: unknown, expected: SidechainTabMetaV1): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const keys = Object.keys(value)
  const expectedKeys = expected.selectedChildId === undefined
    ? ['version']
    : ['version', 'selectedChildId']
  if (keys.length !== expectedKeys.length || !expectedKeys.every(key => keys.includes(key))) return false
  const record = value as Record<string, unknown>
  return record.version === expected.version
    && record.selectedChildId === expected.selectedChildId
}
