// @vitest-environment jsdom
import { StrictMode, useState, type Dispatch, type SetStateAction } from 'react'
import { act } from 'react-dom/test-utils'
import { createRoot, type Root } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import type { CommandNode } from '@deepseek-ai/dsh-client-runtime/client'
import { SidechainCommandObserver, observeCreatedChildren, resolveChildSessionId } from '../src/client/sidechain/observer.tsx'
import type { SidechainController } from '../src/client/sidechain/controller.ts'

const CHILD = '54c34e5e-1c29-4a6c-a2f7-4b19a3d92914'
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

function node(partial: Partial<CommandNode> = {}): CommandNode {
  return {
    kind: 'command', seq: 1, time: 20, commandId: 'cmd-1' as CommandNode['commandId'],
    name: 'side', args: null, outcome: null, ...partial,
  }
}

function snapshot(nodes: readonly CommandNode[]): never {
  return { sessionId: 'parent', nodes } as never
}

function mountedObserver(initial: readonly CommandNode[]): {
  update: Dispatch<SetStateAction<never>>
  claims: ReturnType<typeof vi.fn>
  unmount: () => void
} {
  const claims = vi.fn()
  const controller: SidechainController = {
    claimSideChild: claims,
    resetSession: vi.fn(),
    deferGenericCandidate: vi.fn(),
    selectChild: vi.fn(),
    clearStaleSelection: vi.fn(),
    dispose: vi.fn(),
  }
  let update!: Dispatch<SetStateAction<never>>
  function Harness() {
    const [value, setValue] = useState(snapshot(initial))
    update = setValue
    return (
      <SidechainCommandObserver
        controller={controller}
        useSession={(selector) => selector(value)}
      />
    )
  }
  const container = document.createElement('div')
  document.body.append(container)
  const root: Root = createRoot(container)
  act(() => { root.render(<StrictMode><Harness /></StrictMode>) })
  return {
    update,
    claims,
    unmount: () => { act(() => { root.unmount() }); container.remove() },
  }
}

describe('sidechain command observation', () => {
  it('accepts only the exact side/btw success marker and a UUID', () => {
    expect(resolveChildSessionId(node({ outcome: { kind: 'success', text: `Side conversation started: ${CHILD}.` } }), 'side')).toBe(CHILD)
    expect(resolveChildSessionId(node({ name: 'btw', outcome: { kind: 'success', text: `BTW question started: ${CHILD}.` } }), 'btw')).toBe(CHILD)
    expect(resolveChildSessionId(node({ outcome: { kind: 'success', text: `Side conversation started: ${CHILD}. trailing` } }), 'side')).toBeUndefined()
    expect(resolveChildSessionId(node({ outcome: { kind: 'success', text: 'Side conversation started: not-a-uuid.' } }), 'side')).toBeUndefined()
  })

  it('uses the first snapshot as replay baseline', () => {
    const baseline = observeCreatedChildren(undefined, [node({ outcome: { kind: 'success', text: `Side conversation started: ${CHILD}.` } })], 10)
    expect(baseline.children).toEqual([])
  })

  it('emits a live already-settled command and pending-to-settled once', () => {
    const initial = observeCreatedChildren(undefined, [], 10)
    const settled = observeCreatedChildren(initial.known, [node({ outcome: { kind: 'success', text: `Side conversation started: ${CHILD}.` } })], 10)
    expect(settled.children).toEqual([CHILD])
    const pending = observeCreatedChildren(initial.known, [node()], 10)
    const completed = observeCreatedChildren(pending.known, [node({ outcome: { kind: 'success', text: `Side conversation started: ${CHILD}.` } })], 10)
    expect(completed.children).toEqual([CHILD])
    expect(observeCreatedChildren(completed.known, [node({ outcome: { kind: 'success', text: `Side conversation started: ${CHILD}.` } })], 10).children).toEqual([])
  })

  it('ignores old replay rows arriving after the baseline and duplicate snapshots', () => {
    const initial = observeCreatedChildren(undefined, [], 20)
    const old = observeCreatedChildren(initial.known, [node({ time: 10, outcome: { kind: 'success', text: `Side conversation started: ${CHILD}.` } })], 20)
    expect(old.children).toEqual([])
    const live = observeCreatedChildren(old.known, [node({ outcome: { kind: 'success', text: `Side conversation started: ${CHILD}.` } })], 20)
    expect(live.children).toEqual([])
    expect(observeCreatedChildren(live.known, [node({ outcome: { kind: 'success', text: `Side conversation started: ${CHILD}.` } })], 20).children).toEqual([])
  })

  it('emits a pending command that started before mount when it later settles', () => {
    const baseline = observeCreatedChildren(undefined, [node({ time: 1 })], 20)
    const settled = observeCreatedChildren(baseline.known, [node({
      time: 1,
      outcome: { kind: 'success', text: `Side conversation started: ${CHILD}.` },
    })], 20)
    expect(settled.children).toEqual([CHILD])
  })

  it('does not consume a discarded render and claims once after committed StrictMode updates', () => {
    const mounted = mountedObserver([])
    act(() => { mounted.update(snapshot([node()])) })
    expect(mounted.claims).not.toHaveBeenCalled()
    act(() => { mounted.update(snapshot([node({ outcome: { kind: 'success', text: `Side conversation started: ${CHILD}.` } })])) })
    expect(mounted.claims).toHaveBeenCalledTimes(1)
    act(() => { mounted.update(snapshot([node({ outcome: { kind: 'success', text: `Side conversation started: ${CHILD}.` } })])) })
    expect(mounted.claims).toHaveBeenCalledTimes(1)
    mounted.unmount()
  })

  it('does not claim a stale session update after unmount', () => {
    const mounted = mountedObserver([])
    mounted.unmount()
    mounted.claims.mockClear()
    expect(mounted.claims).not.toHaveBeenCalled()
  })
})
