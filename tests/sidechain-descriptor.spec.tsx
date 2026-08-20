// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'
import type { SidebarSubagentCatalog } from '../src/context-types.ts'
import type { BetterSidebarService, SidebarState, SidebarStore, SidebarTab, TabComponentProps } from '../src/client/service.ts'
import { SidechainView } from '../src/client/sidechain/SidechainView.tsx'
import type { SidechainController } from '../src/client/sidechain/controller.ts'
import type { SidechainHistory } from '../src/client/sidechain/history.ts'
import { createSidechainTab } from '../src/client/sidechain/register.tsx'
import { IconThinkOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { t } from '../src/client/locales.ts'

function dependencies(): { controller: SidechainController; history: SidechainHistory } {
  return {
    controller: {
      selectChild: vi.fn(),
      clearStaleSelection: vi.fn(),
      claimSideChild: vi.fn(() => false),
      deferGenericCandidate: vi.fn(),
      resetSession: vi.fn(),
      dispose: vi.fn(),
    },
    history: {
      fetchTranscript: vi.fn(async () => ({ rows: [], produced: [], streaming: false, hasMore: false })),
      fetchActivity: vi.fn(async () => null),
      sendPrompt: vi.fn(async () => true),
      dispose: vi.fn(),
    },
  }
}

function catalog(entries: SidebarSubagentCatalog['entries'], overrides: Partial<SidebarSubagentCatalog> = {}) {
  return { entries, parentAvailable: true, state: 'ready' as const, error: null, ...overrides }
}

describe('Sidechain descriptor factory', () => {
  it('defines the fixed metadata contract', () => {
    const deps = dependencies()
    const descriptor = createSidechainTab(deps)

    expect(descriptor.id).toBe('sidechain')
    expect(descriptor.title).toBeTypeOf('function')
    expect((descriptor.title as () => string)()).toBe(t('sidechain'))
    expect(descriptor.order).toBe(35)
    expect(descriptor.single).toBe(true)
    expect(descriptor.icon).toBeTypeOf('function')
    const icon = (descriptor.icon as (size: number) => ReactElement)(18)
    expect(icon.type).toBe(IconThinkOutline16)
    expect(icon.props.size).toBe(18)
    const toggle = descriptor.settings?.toggles?.[0]
    expect(toggle?.key).toBe('autoOpenSidechain')
    expect(toggle?.title).toBeTypeOf('function')
    expect(toggle?.title instanceof Function ? toggle.title() : toggle?.title).toBe(t('autoOpenSidechain'))
    expect(toggle?.desc).toBeTypeOf('function')
    expect(toggle?.desc instanceof Function ? toggle.desc() : toggle?.desc).toBe(t('autoOpenSidechainDesc'))
    expect(Object.keys(descriptor).sort()).toEqual([
      'badge', 'component', 'icon', 'id', 'order', 'settings', 'single', 'title',
    ].sort())
  })

  it('forwards every TabComponentProps field and shared dependencies to SidechainView', () => {
    const deps = dependencies()
    const descriptor = createSidechainTab(deps)
    const service = {} as BetterSidebarService
    const forwarded = {
      ctx: { sessions: {}, betterSidebar: service },
      store: {} as SidebarStore,
      scope: { sessionId: 'parent', cwd: '/tmp' },
      tab: { id: 'sidechain', type: 'sidechain', title: 'Sidechain' } as SidebarTab,
      visible: true,
      expanded: ['src'],
      onToggleDir: vi.fn(),
      onReferenceFile: vi.fn(),
      onOpenFile: vi.fn(),
      onOpenDiff: vi.fn(),
      onSubagentJump: vi.fn(),
    } as unknown as TabComponentProps

    const element = descriptor.component(forwarded) as ReactElement
    expect(element.type).toBe(SidechainView)
    expect(element.props).toMatchObject({ ...forwarded, controller: deps.controller, history: deps.history })
    expect(element.props.service).toBe(service)
  })

  it('counts only running direct children in the requested scope for the badge', () => {
    const deps = dependencies()
    const descriptor = createSidechainTab(deps)
    const ctx = {
      sessions: {
        list: {
          getSnapshot: () => ({
            current: 'other',
            byId: {},
            subagentsByParent: {
              parent: catalog([
                { kind: 'child', id: 'running-1', activity: 'running', mode: 'continuable', hasChildren: false },
                { kind: 'child', id: 'running-2', activity: 'running', mode: 'one-shot', hasChildren: false },
                { kind: 'child', id: 'done', activity: 'inactive', mode: 'continuable', hasChildren: false },
                { kind: 'diagnostic', id: 'broken', reason: 'unavailable' },
              ]),
              other: catalog([{ kind: 'child', id: 'foreign-running', activity: 'running', mode: 'one-shot', hasChildren: false }]),
            },
          }),
          subscribe: () => () => {},
        },
      },
    } as never
    expect(descriptor.badge?.(ctx, { sessionId: 'parent' }, {} as SidebarState)).toBe(2)
    expect(descriptor.badge?.(ctx, { sessionId: 'other' }, {} as SidebarState)).toBe(1)
    expect(descriptor.badge?.(ctx, { sessionId: 'missing' }, {} as SidebarState)).toBe(0)
  })

  it.each(['loading', 'error'] as const)('returns zero while the current catalog is %s', (state) => {
    const deps = dependencies()
    const descriptor = createSidechainTab(deps)
    const ctx = {
      sessions: {
        list: {
          getSnapshot: () => ({
            current: 'parent',
            byId: {},
            subagentsByParent: {
              parent: catalog(
                [{ kind: 'child', id: 'still-running', activity: 'running', mode: 'continuable', hasChildren: false }],
                { state },
              ),
            },
          }),
          subscribe: () => () => {},
        },
      },
    } as never
    expect(descriptor.badge?.(ctx, { sessionId: 'parent' }, {} as SidebarState)).toBe(0)
  })
})
