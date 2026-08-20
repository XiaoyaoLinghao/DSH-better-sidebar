import { describe, expect, it } from 'vitest'
import { Config, resolveSidebarConfig, type SidebarConfig } from '../src/config.ts'
import { SIDE_PERSONA } from '../src/sidechain-host/prompts.ts'

describe('sidechain host configuration', () => {
  it('resolves the provider and built-in persona by default without a tool allow-list', () => {
    expect(resolveSidebarConfig(undefined).sidechain).toEqual({
      providerName: 'fork',
      persona: SIDE_PERSONA,
    })
  })

  it('preserves nested persona and read-only tool configuration', () => {
    const config: SidebarConfig = {
      sidechain: { persona: '', readOnlyTools: ['read'] },
    }

    expect(resolveSidebarConfig(config).sidechain).toEqual({
      providerName: 'fork',
      persona: '',
      readOnlyTools: ['read'],
    })
  })

  it('validates an explicitly configured sidechain section through Schemastery', () => {
    const resolved = (Config as unknown as {
      (input: Record<string, unknown> | undefined): Record<string, unknown>
    })({ sidechain: { persona: '', readOnlyTools: ['read'] } })

    expect(resolved.sidechain).toEqual({
      providerName: 'fork',
      persona: '',
      readOnlyTools: ['read'],
    })
  })
})
