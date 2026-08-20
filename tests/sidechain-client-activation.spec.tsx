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
  register: ReturnType<typeof vi.fn>
  liveCards: () => RegisteredSlot[]
  declare: () => void
  collapse: () => void
} {
  const live = new Map<string, RegisteredSlot>()
  const subscriptions = new Set<{ run: () => void; stop: () => void }>()
  let declaredState = declared
  const register = vi.fn((options: Record<string, unknown>, component: unknown) => {
      const dispose = vi.fn()
      const key = String(options.key ?? options.id)
      const entry = { options, component, dispose }
      if (live.has(key)) throw new Error(`duplicate live card ${key}`)
      live.set(key, entry)
      dispose.mockImplementation(() => {
        if (live.get(key) === entry) live.delete(key)
      })
      return dispose
  })
  const slots = {
    register,
    inject: vi.fn((_key: string, callback: () => () => void) => {
      let active: (() => void) | undefined
      let stopped = false
      const run = () => {
        if (stopped || active !== undefined) return
        active = callback()
      }
      const subscription = {
        run,
        stop: () => {
          active?.()
          active = undefined
        },
      }
      subscriptions.add(subscription)
      if (declaredState) run()
      return () => {
        stopped = true
        subscription.stop()
        subscriptions.delete(subscription)
      }
    }),
  }
  const ctx = {
    slots,
    connection: { api: { subagents: { history: vi.fn(), prompt: vi.fn() } } },
  } as unknown as Context
  return {
    ctx,
    register,
    liveCards: () => [...live.values()],
    declare: () => {
      declaredState = true
      for (const subscription of subscriptions) subscription.run()
    },
    collapse: () => {
      declaredState = false
      for (const subscription of subscriptions) subscription.stop()
    },
  }
}

describe('sidechain client activation', () => {
  it('registers two cards plus a nonvisual observer and supports a late slot declaration', () => {
    const { ctx, register, liveCards, declare, collapse } = fakeContext(false)
    const store = createSidebarStore()
    const service = createBetterSidebarService(store)
    const runtime = createSidechainClientRuntime(ctx, service, store)

    expect(liveCards()).toHaveLength(0)
    declare()
    expect(liveCards().map(entry => entry.options.key ?? entry.options.id).sort()).toEqual(['btw', 'side', 'sidechain-command-observer'])
    expect(liveCards().filter(entry => entry.options.name === 'conversation.chat.commandview')).toHaveLength(2)
    expect(liveCards().filter(entry => entry.options.name === 'conversation.input.dock')).toHaveLength(1)

    collapse()
    expect(liveCards()).toHaveLength(0)
    declare()
    expect(liveCards().map(entry => entry.options.key ?? entry.options.id).sort()).toEqual(['btw', 'side', 'sidechain-command-observer'])

    runtime.dispose()
    runtime.dispose()
    expect(liveCards()).toHaveLength(0)
    expect(register).toHaveBeenCalledTimes(6)
    expect(register.mock.calls.map(call => call[0].key ?? call[0].id).sort()).toEqual([
      'btw', 'btw', 'side', 'side', 'sidechain-command-observer', 'sidechain-command-observer',
    ])
    expect(liveCards()).toHaveLength(0)
    declare()
    expect(liveCards()).toHaveLength(0)
  })

  it('shares one controller/history pair with the sole sidechain descriptor', () => {
    const { ctx } = fakeContext()
    const store = createSidebarStore()
    const service = createBetterSidebarService(store)
    const runtime = createSidechainClientRuntime(ctx, service, store)
    const historyDispose = vi.spyOn(runtime.history, 'dispose')
    const controllerDispose = vi.spyOn(runtime.controller, 'dispose')
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
    runtime.dispose()
    expect(historyDispose).toHaveBeenCalledTimes(1)
    expect(controllerDispose).toHaveBeenCalledTimes(1)
  })

  it('can reactivate after both builtins and runtime are disposed without duplicates', () => {
    const { ctx, liveCards } = fakeContext()
    const store = createSidebarStore()
    const service = createBetterSidebarService(store)
    const first = createSidechainClientRuntime(ctx, service, store)
    const disposeFirst = registerBuiltins(ctx, service, { sidechain: first.tab })
    expect(liveCards().map(entry => entry.options.key ?? entry.options.id).sort()).toEqual(['btw', 'side', 'sidechain-command-observer'])
    disposeFirst()
    first.dispose()
    expect(liveCards()).toHaveLength(0)

    const second = createSidechainClientRuntime(ctx, service, store)
    const disposeSecond = registerBuiltins(ctx, service, { sidechain: second.tab })
    expect(service.getTabs().filter(tab => tab.id === 'sidechain')).toHaveLength(1)
    expect(liveCards().map(entry => entry.options.key ?? entry.options.id).sort()).toEqual(['btw', 'side', 'sidechain-command-observer'])
    disposeSecond()
    second.dispose()
    expect(liveCards()).toHaveLength(0)
  })
})
