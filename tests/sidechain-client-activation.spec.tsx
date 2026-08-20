import { describe, expect, it, vi } from 'vitest'
import './browser-globals.ts'

import type { Context } from '../src/context-types.ts'
import { createBetterSidebarService } from '../src/client/service.ts'
import { createSidebarStore } from '../src/client/state.ts'
import { registerBuiltins } from '../src/client/builtins/index.ts'
import { createSidechainClientRuntime } from '../src/client/sidechain/index.tsx'

interface RegisteredSlot {
  options: Record<string, unknown>
  component: unknown
  dispose: ReturnType<typeof vi.fn>
}

function fakeContext(declared = true): {
  ctx: Context
  registered: RegisteredSlot[]
  declare: () => void
} {
  const registered: RegisteredSlot[] = []
  const pendings: Array<() => void> = []
  const slots = {
    register: vi.fn((options: Record<string, unknown>, component: unknown) => {
      const dispose = vi.fn()
      registered.push({ options, component, dispose })
      return dispose
    }),
    inject: vi.fn((_key: string, callback: () => () => void) => {
      let active: (() => void) | undefined
      let stopped = false
      const run = () => {
        if (stopped || active !== undefined) return
        active = callback()
      }
      if (declared) run()
      else pendings.push(run)
      return () => {
        stopped = true
        active?.()
      }
    }),
  }
  const ctx = {
    slots,
    connection: { api: { subagents: { history: vi.fn(), prompt: vi.fn() } } },
  } as unknown as Context
  return { ctx, registered, declare: () => { for (const run of pendings) run() } }
}

describe('sidechain client activation', () => {
  it('registers exactly two keyed cards and supports a late slot declaration', () => {
    const { ctx, registered, declare } = fakeContext(false)
    const store = createSidebarStore()
    const service = createBetterSidebarService(store)
    const runtime = createSidechainClientRuntime(ctx, service, store)

    expect(registered).toHaveLength(0)
    declare()
    expect(registered.map(entry => entry.options.key)).toEqual(['side', 'btw'])
    expect(registered.every(entry => entry.options.name === 'conversation.chat.commandview')).toBe(true)

    runtime.dispose()
    runtime.dispose()
    expect(registered.every(entry => entry.dispose.mock.calls.length === 1)).toBe(true)
  })

  it('shares one controller/history pair with the sole sidechain descriptor', () => {
    const { ctx } = fakeContext()
    const store = createSidebarStore()
    const service = createBetterSidebarService(store)
    const runtime = createSidechainClientRuntime(ctx, service, store)
    const disposeBuiltins = registerBuiltins(ctx, service, { sidechain: runtime.tab })

    expect(service.getTabs().filter(tab => tab.id === 'sidechain')).toHaveLength(1)
    const descriptor = service.getTab('sidechain')!
    const element = descriptor.component({
      ctx,
      store,
      scope: { sessionId: 's1' },
      tab: { id: 'sidechain', type: 'sidechain', title: 'Sidechain' },
      visible: false,
    } as never) as { props: { controller: unknown; history: unknown } }
    expect(element.props.controller).toBe(runtime.controller)
    expect(element.props.history).toBe(runtime.history)

    disposeBuiltins()
    expect(service.getTab('sidechain')).toBeUndefined()
    runtime.dispose()
  })

  it('can reactivate after both builtins and runtime are disposed without duplicates', () => {
    const { ctx } = fakeContext()
    const store = createSidebarStore()
    const service = createBetterSidebarService(store)
    const first = createSidechainClientRuntime(ctx, service, store)
    const disposeFirst = registerBuiltins(ctx, service, { sidechain: first.tab })
    disposeFirst()
    first.dispose()

    const second = createSidechainClientRuntime(ctx, service, store)
    const disposeSecond = registerBuiltins(ctx, service, { sidechain: second.tab })
    expect(service.getTabs().filter(tab => tab.id === 'sidechain')).toHaveLength(1)
    disposeSecond()
    second.dispose()
  })
})
