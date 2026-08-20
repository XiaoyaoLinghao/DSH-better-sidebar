import { describe, expect, it } from 'vitest'
import type { CommandNode } from '@deepseek-ai/dsh-client-runtime/client'
import { observeCreatedChildren, resolveChildSessionId } from '../src/client/sidechain/observer.tsx'

const CHILD = '54c34e5e-1c29-4a6c-a2f7-4b19a3d92914'

function node(partial: Partial<CommandNode> = {}): CommandNode {
  return {
    kind: 'command', seq: 1, time: 20, commandId: 'cmd-1' as CommandNode['commandId'],
    name: 'side', args: null, outcome: null, ...partial,
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
})
