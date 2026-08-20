// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { createElement, type ReactNode } from 'react'
import { act } from 'react-dom/test-utils'
import { createRoot, type Root } from 'react-dom/client'
import type { CommandNode } from '@deepseek-ai/dsh-client-runtime/client'
import { getSidechainLabels } from '../src/client/locales.ts'
import {
  createSidechainCommandCards,
  SideCommandCard,
} from '../src/client/sidechain/SideCommandCard.tsx'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

function node(name: 'side' | 'btw', outcome: CommandNode['outcome']): CommandNode {
  return {
    kind: 'command', seq: 1, time: 1, commandId: 'command-1' as CommandNode['commandId'],
    name, args: ' question', outcome,
  }
}

function mount(element: ReactNode): { container: HTMLDivElement; root: Root } {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  act(() => { root.render(element) })
  return { container, root }
}

function unmount(root: Root, container: HTMLElement): void {
  act(() => { root.unmount() })
  container.remove()
}

afterEach(() => { document.body.innerHTML = '' })

describe('Sidechain command-card contributions', () => {
  it('publishes exactly the side and btw keyed contributions using one component', () => {
    const cards = createSidechainCommandCards()
    expect(cards).toHaveLength(2)
    expect(cards.map(card => card.key)).toEqual(['side', 'btw'])
    expect(cards.every(card => card.component === SideCommandCard)).toBe(true)
  })

  it.each(['side', 'btw'] as const)('renders an accessible pending status for /%s', key => {
    const { container, root } = mount(createElement(SideCommandCard, { node: node(key, null) }))
    const status = container.querySelector('[role="status"]')
    expect(status).not.toBeNull()
    expect(status?.textContent).toContain(getSidechainLabels().sidechainRunning)
    expect(status?.getAttribute('aria-live')).toBe('polite')
    expect(status?.getAttribute('data-state')).toBe('running')
    unmount(root, container)
  })

  it.each(['side', 'btw'] as const)('renders the successful result for /%s', key => {
    const result = 'The side result'
    const { container, root } = mount(createElement(SideCommandCard, {
      node: node(key, { kind: 'success', text: result }),
    }))
    const status = container.querySelector('[role="status"]')
    expect(status?.textContent).toContain(getSidechainLabels().sidechainInactive)
    expect(status?.textContent).toContain(result)
    expect(status?.getAttribute('data-state')).toBe('success')
    unmount(root, container)
  })

  it.each(['side', 'btw'] as const)('renders the failure result for /%s', key => {
    const failure = 'The side command failed'
    const { container, root } = mount(createElement(SideCommandCard, {
      node: node(key, { kind: 'error', text: failure }),
    }))
    const status = container.querySelector('[role="status"]')
    expect(status?.textContent).toContain(getSidechainLabels().sidechainPromptFailed)
    expect(status?.textContent).toContain(failure)
    expect(status?.getAttribute('data-state')).toBe('failure')
    unmount(root, container)
  })

  it('renders no panel host, fixed aside, or session-header toggle markup', () => {
    const { container, root } = mount(createElement(SideCommandCard, { node: node('side', null) }))
    expect(container.querySelector('aside')).toBeNull()
    expect(container.querySelector('[data-dsh-panel-host]')).toBeNull()
    expect(container.querySelector('[data-sidechain-session-header-toggle]')).toBeNull()
    expect(container.querySelector('button')).toBeNull()
    unmount(root, container)
  })
})
